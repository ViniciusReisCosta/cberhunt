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
    const secretKey = this.getConfiguredStripeSecretKey();
    this.stripe = secretKey ? new Stripe(secretKey) : null;
  }

  @Post('subscribe')
  async subscribe(@Req() req: Request, @Body() body: { planSlug?: string }) {
    const stripe = this.getStripeOrThrow('checkout');

    const user = await this.auth.requireAccess(req, { requirePayment: false });
    if (user.role !== 'company_admin' && user.role !== 'super_admin') {
      throw new BadRequestException('Only company admins can manage billing');
    }
    if (!user.companyId || !user.company) {
      throw new BadRequestException('Company ID required');
    }

    const plan = await this.plans.findOne({
      where: { slug: body.planSlug || '' },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    const stripePriceId = this.getStripePriceIdOrThrow(plan);

    let stripeCustomerId = user.company.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.company.email || user.email,
        name: user.company.name,
        metadata: { companyId: user.company.id },
      });
      stripeCustomerId = customer.id;
      await this.companies.update(
        { id: user.company.id },
        { stripeCustomerId },
      );
    }

    const appUrl = this.getAppUrl();
    const metadata = {
      companyId: user.company.id,
      userId: user.id,
      planSlug: plan.slug,
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [{ price: stripePriceId, quantity: 1 }],
      client_reference_id: user.company.id,
      metadata,
      subscription_data: { metadata },
      success_url: `${appUrl}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/billing?checkout=canceled`,
    });

    if (!session.url) {
      throw new InternalServerErrorException(
        'Stripe did not return a checkout URL',
      );
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
    const stripe = this.getStripeOrThrow('webhook');

    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!signature || !webhookSecret) {
      throw new BadRequestException({
        error: 'Missing Stripe webhook configuration',
        code: 'STRIPE_WEBHOOK_SECRET_MISSING',
        config: 'STRIPE_WEBHOOK_SECRET',
      });
    }

    let event: Stripe.Event;
    try {
      const payload = req.rawBody;
      if (!payload) throw new Error('Missing raw request body');
      event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Invalid webhook payload';
      throw new BadRequestException(message);
    }

    console.log('Stripe webhook received', {
      id: event.id,
      type: event.type,
      livemode: event.livemode,
    });

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      case 'checkout.session.async_payment_succeeded':
        await this.handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      case 'checkout.session.async_payment_failed':
        await this.handleCheckoutSessionStatus(
          event.data.object as Stripe.Checkout.Session,
          PaymentStatus.Failed,
          false,
        );
        break;
      case 'checkout.session.expired':
        await this.handleCheckoutExpired(
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      case 'payment_intent.succeeded':
        await this.handlePaymentIntent(
          event.data.object as Stripe.PaymentIntent,
          PaymentStatus.Paid,
          true,
        );
        break;
      case 'payment_intent.payment_failed':
        await this.handlePaymentIntent(
          event.data.object as Stripe.PaymentIntent,
          PaymentStatus.Failed,
          false,
        );
        break;
      case 'payment_intent.canceled':
        await this.handlePaymentIntent(
          event.data.object as Stripe.PaymentIntent,
          PaymentStatus.Canceled,
          false,
        );
        break;
      case 'invoice.paid':
        await this.handleInvoice(
          event.data.object as Stripe.Invoice,
          PaymentStatus.Paid,
          true,
        );
        break;
      case 'invoice.payment_failed':
        await this.handleInvoice(
          event.data.object as Stripe.Invoice,
          PaymentStatus.Failed,
          false,
        );
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.handleSubscription(event.data.object as Stripe.Subscription);
        break;
      default:
        console.log('Stripe webhook ignored', {
          id: event.id,
          type: event.type,
        });
        break;
    }

    return { received: true };
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    return this.handleCheckoutSessionStatus(session, PaymentStatus.Paid, true);
  }

  private async handleCheckoutExpired(session: Stripe.Checkout.Session) {
    return this.handleCheckoutSessionStatus(
      session,
      PaymentStatus.Canceled,
      false,
    );
  }

  private async handleCheckoutSessionStatus(
    session: Stripe.Checkout.Session,
    paymentStatus: PaymentStatus,
    active: boolean,
  ) {
    const companyId =
      session.metadata?.companyId || session.client_reference_id;
    if (!companyId) return false;

    const stripeCustomerId = this.getExpandableId(session.customer);
    const stripeSubscriptionId = this.getExpandableId(session.subscription);
    const data: Partial<Company> = {
      paymentStatus,
      active,
    };
    if (stripeCustomerId) data.stripeCustomerId = stripeCustomerId;
    if (stripeSubscriptionId) data.stripeSubscriptionId = stripeSubscriptionId;
    if (session.metadata?.planSlug) data.plan = session.metadata.planSlug;

    await this.updateCompanyBilling(companyId, data);
    return true;
  }

  private async handlePaymentIntent(
    paymentIntent: Stripe.PaymentIntent,
    paymentStatus: PaymentStatus,
    active: boolean,
  ) {
    const session =
      await this.retrieveCheckoutSessionFromPaymentIntent(paymentIntent);
    if (session) {
      const updated = await this.handleCheckoutSessionStatus(
        session,
        paymentStatus,
        active,
      );
      if (updated) return;
    }

    const customerId = this.getExpandableId(paymentIntent.customer);
    const company = paymentIntent.metadata?.companyId
      ? await this.companies.findOne({
          where: { id: paymentIntent.metadata.companyId },
        })
      : await this.findCompanyByStripeIds(customerId, null);

    if (!company) {
      console.warn('Stripe payment intent did not match a company', {
        paymentIntentId: paymentIntent.id,
        customerId,
        status: paymentIntent.status,
      });
      return;
    }

    await this.updateCompanyBilling(company.id, {
      paymentStatus,
      active,
      stripeCustomerId: customerId || company.stripeCustomerId,
      plan: paymentIntent.metadata?.planSlug || company.plan,
    });
  }

  private async handleInvoice(
    invoice: Stripe.Invoice,
    status: PaymentStatus,
    active: boolean,
  ) {
    const subscriptionId = this.getInvoiceSubscriptionId(invoice);
    const company = await this.findCompanyByStripeIds(
      this.getExpandableId(invoice.customer),
      subscriptionId,
    );
    if (!company) return;

    await this.updateCompanyBilling(company.id, {
      paymentStatus: status,
      active,
    });
    await this.upsertInvoice(company.id, invoice, status);
  }

  private async handleSubscription(subscription: Stripe.Subscription) {
    const company = await this.findCompanyByStripeIds(
      this.getExpandableId(subscription.customer),
      subscription.id,
    );
    if (!company) return;

    const paymentStatus = this.resolvePaymentStatus(subscription.status);
    await this.updateCompanyBilling(company.id, {
      paymentStatus,
      active: paymentStatus === PaymentStatus.Paid,
      stripeCustomerId: this.getExpandableId(subscription.customer),
      stripeSubscriptionId: subscription.id,
    });
  }

  private async updateCompanyBilling(
    companyId: string,
    data: Partial<Company>,
  ) {
    await this.companies.update({ id: companyId }, data);
  }

  private async findCompanyByStripeIds(
    customerId?: string | null,
    subscriptionId?: string | null,
  ) {
    const where: FindOptionsWhere<Company>[] = [];
    if (customerId) where.push({ stripeCustomerId: customerId });
    if (subscriptionId) where.push({ stripeSubscriptionId: subscriptionId });
    if (where.length === 0) return null;
    return this.companies.findOne({ where });
  }

  private async upsertInvoice(
    companyId: string,
    invoice: Stripe.Invoice,
    paymentStatus: PaymentStatus,
  ) {
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
    return this.getExpandableId(invoiceWithSubscription.subscription);
  }

  private async retrieveCheckoutSessionFromPaymentIntent(
    paymentIntent: Stripe.PaymentIntent,
  ) {
    const sessionId = this.getCheckoutSessionIdFromPaymentIntent(paymentIntent);
    if (!sessionId || !this.stripe) return null;

    try {
      return await this.stripe.checkout.sessions.retrieve(sessionId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown Stripe error';
      console.warn('Could not retrieve checkout session for payment intent', {
        paymentIntentId: paymentIntent.id,
        sessionId,
        error: message,
      });
      return null;
    }
  }

  private getCheckoutSessionIdFromPaymentIntent(
    paymentIntent: Stripe.PaymentIntent,
  ) {
    const paymentIntentWithDetails = paymentIntent as Stripe.PaymentIntent & {
      payment_details?: { order_reference?: string | null } | null;
    };
    const orderReference =
      paymentIntentWithDetails.payment_details?.order_reference;
    return typeof orderReference === 'string' &&
      orderReference.startsWith('cs_')
      ? orderReference
      : null;
  }

  private getExpandableId(value: string | { id?: string } | null | undefined) {
    return typeof value === 'string' ? value : value?.id || null;
  }

  private getAppUrl() {
    return (
      this.config.get<string>('APP_URL') ||
      this.config.get<string>('FRONTEND_ORIGIN') ||
      'http://localhost:3000'
    );
  }

  private getConfiguredStripeSecretKey() {
    return this.config.get<string>('STRIPE_SECRET_KEY')?.trim() || '';
  }

  private getStripeOrThrow(context: 'checkout' | 'webhook') {
    if (this.stripe) return this.stripe;

    throw new InternalServerErrorException({
      error:
        context === 'checkout'
          ? 'Stripe checkout is not configured on the backend'
          : 'Stripe webhook handling is not configured on the backend',
      code: 'STRIPE_SECRET_KEY_MISSING',
      config: 'STRIPE_SECRET_KEY',
    });
  }

  private getStripePriceIdOrThrow(plan: Plan) {
    const config = this.getStripePriceConfigName(plan.slug);
    const priceId =
      plan.stripePriceId?.trim() || this.config.get<string>(config)?.trim();

    if (!priceId) {
      throw new BadRequestException({
        error: `Stripe price is not configured for the ${plan.name} plan`,
        code: 'STRIPE_PRICE_MISSING',
        config,
      });
    }

    if (!priceId.startsWith('price_')) {
      throw new BadRequestException({
        error: `Stripe price for the ${plan.name} plan must be a Price ID starting with "price_"`,
        code: 'STRIPE_PRICE_INVALID',
        config,
      });
    }

    return priceId;
  }

  private getStripePriceConfigName(planSlug: string) {
    switch (planSlug) {
      case 'starter':
        return 'STRIPE_PRICE_STARTER';
      case 'professional':
        return 'STRIPE_PRICE_PROFESSIONAL';
      case 'enterprise':
        return 'STRIPE_PRICE_ENTERPRISE';
      default:
        return 'STRIPE_PRICE_*';
    }
  }
}
