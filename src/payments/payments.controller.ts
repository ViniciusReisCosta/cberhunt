import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Logger,
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
  private readonly logger = new Logger(PaymentsController.name);
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
    this.logger.log(
      `POST /api/payments/subscribe received ${JSON.stringify(this.getRequestLogPayload(req, body))}`,
    );

    const stripe = this.getStripeOrThrow('checkout');

    let user;
    try {
      user = await this.auth.requireAccess(req, { requirePayment: false });
      this.logger.log(
        `POST /api/payments/subscribe auth ok ${JSON.stringify({
          userId: user.id,
          role: user.role,
          companyId: user.companyId,
          hasCompany: Boolean(user.company),
          companyPaymentStatus: user.company?.paymentStatus ?? null,
          companyActive: user.company?.active ?? null,
        })}`,
      );
    } catch (error) {
      this.logger.error(
        `POST /api/payments/subscribe auth failed ${JSON.stringify({
          status: this.getErrorStatus(error),
          message: error instanceof Error ? error.message : String(error),
          request: this.getRequestLogPayload(req, body),
        })}`,
      );
      throw error;
    }

    if (user.role !== 'company_admin' && user.role !== 'super_admin') {
      this.logger.warn(
        `POST /api/payments/subscribe rejected by role ${JSON.stringify({
          userId: user.id,
          role: user.role,
          companyId: user.companyId,
        })}`,
      );
      throw new BadRequestException('Only company admins can manage billing');
    }
    if (!user.companyId || !user.company) {
      this.logger.warn(
        `POST /api/payments/subscribe rejected without company ${JSON.stringify({
          userId: user.id,
          role: user.role,
          companyId: user.companyId,
          hasCompany: Boolean(user.company),
        })}`,
      );
      throw new BadRequestException('Company ID required');
    }

    const plan = await this.plans.findOne({ where: { slug: body.planSlug || '' } });
    if (!plan) {
      this.logger.warn(
        `POST /api/payments/subscribe plan not found ${JSON.stringify({
          planSlug: body.planSlug ?? null,
          userId: user.id,
          companyId: user.company.id,
        })}`,
      );
      throw new NotFoundException('Plan not found');
    }

    this.logger.log(
      `POST /api/payments/subscribe creating checkout ${JSON.stringify({
        userId: user.id,
        companyId: user.company.id,
        planSlug: plan.slug,
        hasStripeCustomerId: Boolean(user.company.stripeCustomerId),
      })}`,
    );

    const stripePriceId = this.getStripePriceIdOrThrow(plan);

    let stripeCustomerId = user.company.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.company.email || user.email,
        name: user.company.name,
        metadata: { companyId: user.company.id },
      });
      stripeCustomerId = customer.id;
      await this.companies.update({ id: user.company.id }, { stripeCustomerId });
    }

    const appUrl = this.getAppUrl();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [{ price: stripePriceId, quantity: 1 }],
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
      this.logger.error(
        `POST /api/payments/subscribe stripe session without url ${JSON.stringify({
          userId: user.id,
          companyId: user.company.id,
          planSlug: plan.slug,
          sessionId: session.id,
        })}`,
      );
      throw new InternalServerErrorException('Stripe did not return a checkout URL');
    }

    await this.companies.update(
      { id: user.company.id },
      { paymentStatus: PaymentStatus.Pending, active: false },
    );

    return { url: session.url };
  }

  private getRequestLogPayload(req: Request, body: unknown) {
    return {
      method: req.method,
      originalUrl: req.originalUrl,
      path: req.path,
      ip: req.ip,
      ips: req.ips,
      protocol: req.protocol,
      secure: req.secure,
      hostname: req.hostname,
      headers: this.sanitizeRecord(req.headers),
      rawHeaders: this.sanitizeRawHeaders(req.rawHeaders),
      cookies: this.sanitizeRecord((req as Request & { cookies?: Record<string, string> }).cookies ?? {}),
      signedCookies: this.sanitizeRecord(
        (req as Request & { signedCookies?: Record<string, string> }).signedCookies ?? {},
      ),
      query: req.query,
      params: req.params,
      body,
    };
  }

  private sanitizeRawHeaders(rawHeaders: string[] = []) {
    return rawHeaders.map((value, index) => {
      const headerName = index % 2 === 0 ? value : rawHeaders[index - 1];
      return this.isSensitiveKey(headerName) ? this.maskSensitiveValue(value) : value;
    });
  }

  private sanitizeRecord(record: Record<string, unknown>) {
    return Object.entries(record).reduce<Record<string, unknown>>((acc, [key, value]) => {
      acc[key] = this.isSensitiveKey(key) ? this.maskSensitiveValue(value) : value;
      return acc;
    }, {});
  }

  private isSensitiveKey(key: string | undefined) {
    const normalized = key?.toLowerCase() ?? '';
    return normalized === 'cookie' || normalized === 'authorization' || normalized.includes('token');
  }

  private maskSensitiveValue(value: unknown) {
    if (typeof value !== 'string') return value ? '[present]' : value;
    if (!value) return value;
    if (value.length <= 12) return `[present:${value.length}]`;
    return `${value.slice(0, 6)}...${value.slice(-4)} [len:${value.length}]`;
  }

  private getErrorStatus(error: unknown) {
    return typeof error === 'object' &&
      error !== null &&
      'getStatus' in error &&
      typeof error.getStatus === 'function'
      ? error.getStatus()
      : null;
  }

  @Post('webhook')
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    const stripe = this.getStripeOrThrow('webhook');
    console.log('Received Stripe webhook', req.rawBody, signature);
    console.log('LOGXXX', req.body, req.headers, req.rawBody);
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!signature || !webhookSecret) {
      console.error('Missing Stripe webhook configuration', { signature, webhookSecret });
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
    const priceId = plan.stripePriceId?.trim() || this.config.get<string>(config)?.trim();

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
