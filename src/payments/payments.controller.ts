import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  InternalServerErrorException,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import Stripe from 'stripe';
import { AuthService } from '../auth/auth.service';
import { Company, PaymentStatus } from '../database/entities/company.entity';
import { Invoice } from '../database/entities/invoice.entity';
import { Plan } from '../database/entities/plan.entity';
import { FindOptionsWhere, Repository } from 'typeorm';

@Controller('payments')
export class PaymentsController {
  private readonly stripe: Stripe | null;

  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    @InjectRepository(Plan)
    private readonly plans: Repository<Plan>,
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    @InjectRepository(Invoice)
    private readonly invoices: Repository<Invoice>,
  ) {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    this.stripe = secretKey ? new Stripe(secretKey) : null;
  }

  @Post('subscribe')
  async subscribe(@Req() req: Request, @Body() body: { planSlug?: string }) {
    if (!this.stripe) {
      throw new InternalServerErrorException('Stripe is not configured');
    }

    const user = await this.auth.requireAccess(req, { requirePayment: false });
    if (user.role !== 'company_admin' && user.role !== 'super_admin') {
      throw new BadRequestException('Only company admins can manage billing');
    }
    if (!user.companyId || !user.company) {
      throw new BadRequestException('Company ID required');
    }

    const plan = await this.plans.findOne({ where: { slug: body.planSlug || '' } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (!plan.stripePriceId) {
      throw new BadRequestException('Stripe price is not configured for this plan');
    }

    let stripeCustomerId = user.company.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await this.stripe.customers.create({
        email: user.company.email || user.email,
        name: user.company.name,
        metadata: { companyId: user.company.id },
      });
      stripeCustomerId = customer.id;
      await this.companies.update({ id: user.company.id }, { stripeCustomerId });
    }

    const appUrl = this.getAppUrl();
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      client_reference_id: user.company.id,
      metadata: {
        companyId: user.company.id,
        userId: user.id,
        planSlug: plan.slug,
      },
      success_url: `${appUrl}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/billing?checkout=canceled`,
    });

    if (!session.url) {
      throw new InternalServerErrorException('Stripe did not return a checkout URL');
    }

    await this.companies.update(
      { id: user.company.id },
      { paymentStatus: PaymentStatus.Pending, active: false },
    );

    return { url: session.url };
  }

  @Post('webhook')
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    if (!this.stripe) {
      throw new InternalServerErrorException('Stripe is not configured');
    }

    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!signature || !webhookSecret) {
      throw new BadRequestException('Missing Stripe webhook configuration');
    }

    let event: Stripe.Event;
    try {
      const payload = req.rawBody;
      if (!payload) throw new Error('Missing raw request body');
      event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid webhook payload';
      throw new BadRequestException(message);
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'checkout.session.expired':
        await this.handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
        break;
      case 'invoice.paid':
        await this.handleInvoice(event.data.object as Stripe.Invoice, PaymentStatus.Paid, true);
        break;
      case 'invoice.payment_failed':
        await this.handleInvoice(event.data.object as Stripe.Invoice, PaymentStatus.Failed, false);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.handleSubscription(event.data.object as Stripe.Subscription);
        break;
      default:
        break;
    }

    return { received: true };
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const companyId = session.metadata?.companyId || session.client_reference_id;
    if (!companyId) return;

    await this.updateCompanyBilling(companyId, {
      paymentStatus: PaymentStatus.Paid,
      active: true,
      stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
      stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : null,
      plan: session.metadata?.planSlug,
    });
  }

  private async handleCheckoutExpired(session: Stripe.Checkout.Session) {
    const companyId = session.metadata?.companyId || session.client_reference_id;
    if (!companyId) return;
    await this.updateCompanyBilling(companyId, {
      paymentStatus: PaymentStatus.Canceled,
      active: false,
    });
  }

  private async handleInvoice(invoice: Stripe.Invoice, status: PaymentStatus, active: boolean) {
    const subscriptionId = this.getInvoiceSubscriptionId(invoice);
    const company = await this.findCompanyByStripeIds(
      typeof invoice.customer === 'string' ? invoice.customer : null,
      subscriptionId,
    );
    if (!company) return;

    await this.updateCompanyBilling(company.id, { paymentStatus: status, active });
    await this.upsertInvoice(company.id, invoice, status);
  }

  private async handleSubscription(subscription: Stripe.Subscription) {
    const company = await this.findCompanyByStripeIds(
      typeof subscription.customer === 'string' ? subscription.customer : null,
      subscription.id,
    );
    if (!company) return;

    const paymentStatus = this.resolvePaymentStatus(subscription.status);
    await this.updateCompanyBilling(company.id, {
      paymentStatus,
      active: paymentStatus === PaymentStatus.Paid,
      stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null,
      stripeSubscriptionId: subscription.id,
    });
  }

  private async updateCompanyBilling(companyId: string, data: Partial<Company>) {
    await this.companies.update({ id: companyId }, data);
  }

  private async findCompanyByStripeIds(customerId?: string | null, subscriptionId?: string | null) {
    const where: FindOptionsWhere<Company>[] = [];
    if (customerId) where.push({ stripeCustomerId: customerId });
    if (subscriptionId) where.push({ stripeSubscriptionId: subscriptionId });
    if (where.length === 0) return null;
    return this.companies.findOne({ where });
  }

  private async upsertInvoice(companyId: string, invoice: Stripe.Invoice, paymentStatus: PaymentStatus) {
    const stripeInvoiceId = invoice.id || null;
    const existing = stripeInvoiceId
      ? await this.invoices.findOne({ where: { stripeInvoiceId } })
      : null;

    const amount = (invoice.amount_paid || invoice.amount_due || 0) / 100;
    const status = invoice.status || paymentStatus;
    const hostedInvoiceUrl = invoice.hosted_invoice_url || null;

    const data = {
      companyId,
      stripeInvoiceId,
      amount,
      currency: invoice.currency || 'brl',
      status,
      hostedInvoiceUrl,
    };

    if (existing) {
      await this.invoices.update({ id: existing.id }, data);
      return;
    }

    await this.invoices.save(this.invoices.create(data));
  }

  private resolvePaymentStatus(status: string | null | undefined) {
    switch (status) {
      case 'active':
      case 'trialing':
      case 'paid':
        return PaymentStatus.Paid;
      case 'past_due':
      case 'unpaid':
      case 'incomplete':
        return PaymentStatus.Failed;
      case 'canceled':
      case 'incomplete_expired':
        return PaymentStatus.Canceled;
      default:
        return PaymentStatus.Pending;
    }
  }

  private getInvoiceSubscriptionId(invoice: Stripe.Invoice) {
    const invoiceWithSubscription = invoice as Stripe.Invoice & {
      subscription?: string | Stripe.Subscription | null;
    };
    return typeof invoiceWithSubscription.subscription === 'string'
      ? invoiceWithSubscription.subscription
      : null;
  }

  private getAppUrl() {
    return (
      this.config.get<string>('APP_URL') ||
      this.config.get<string>('FRONTEND_ORIGIN') ||
      'http://localhost:3000'
    );
  }
}
