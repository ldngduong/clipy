import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Environment, LogLevel, Paddle } from '@paddle/paddle-node-sdk';
import { PaddleCustomer } from './paddle-customer.entity';
import { PaddleSubscription } from './paddle-subscription.entity';

@Injectable()
export class PaddleService {
  private readonly logger = new Logger(PaddleService.name);
  private readonly paddle: Paddle | null;
  readonly environment: Environment;
  readonly clientToken: string;
  readonly monthlyPriceId: string;
  readonly yearlyPriceId: string;
  private readonly publicBaseUrl: string;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(PaddleCustomer)
    private readonly customersRepo: Repository<PaddleCustomer>,
    @InjectRepository(PaddleSubscription)
    private readonly subsRepo: Repository<PaddleSubscription>,
  ) {
    this.environment =
      config.get<string>('PADDLE_ENV') === 'production'
        ? Environment.production
        : Environment.sandbox;
    this.clientToken = config.get<string>('PADDLE_CLIENT_TOKEN') ?? '';
    this.monthlyPriceId = config.get<string>('PADDLE_PRICE_MONTHLY_ID') ?? '';
    this.yearlyPriceId = config.get<string>('PADDLE_PRICE_YEARLY_ID') ?? '';
    this.publicBaseUrl = (
      config.get<string>('PUBLIC_BASE_URL') ?? 'http://localhost:3210'
    ).replace(/\/+$/, '');

    const apiKey = config.get<string>('PADDLE_API_KEY') ?? '';
    this.paddle = apiKey
      ? new Paddle(apiKey, { environment: this.environment, logLevel: LogLevel.error })
      : null;
  }

  get isEnabled(): boolean {
    return !!this.paddle;
  }

  buildCheckoutUrl(plan: 'monthly' | 'yearly'): string {
    return `${this.publicBaseUrl}/api/paddle/checkout?plan=${plan}`;
  }

  renderCheckoutPage(opts: { plan: 'monthly' | 'yearly'; email: string; lang: 'vi' | 'en' }): string {
    const priceId = opts.plan === 'yearly' ? this.yearlyPriceId : this.monthlyPriceId;
    const env = this.environment === 'production' ? 'production' : 'sandbox';
    const successUrl = `${this.publicBaseUrl}/api/paddle/checkout/success?lang=${opts.lang}`;
    const emailPrefill = opts.email ? `customer: { email: ${JSON.stringify(opts.email)} },` : '';
    const copy = opts.lang === 'vi'
      ? { text: 'Đang mở thanh toán…', err: 'Cửa hàng chưa cấu hình thanh toán' }
      : { text: 'Opening checkout…', err: 'Billing is not configured on the server' };
    return `<!doctype html>
<html lang="${opts.lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Clipy</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .card { text-align: center; padding: 24px; }
  .spin { width: 24px; height: 24px; margin: 0 auto 12px; border-radius: 50%; opacity: .5;
          border: 2px solid currentColor; border-top-color: transparent; animation: rot .8s linear infinite; }
  @keyframes rot { to { transform: rotate(360deg); } }
  .text { font-size: 14px; font-weight: 600; }
</style>
</head>
<body>
  <div class="card"><div class="spin"></div><div class="text">${copy.text}</div></div>
  <script>document.body.style.background=window.matchMedia("(prefers-color-scheme: dark)").matches?"#18181b":"#ffffff";document.body.style.color=window.matchMedia("(prefers-color-scheme: dark)").matches?"#fafafa":"#18181b";</script>
  <script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>
  <script>
    const priceId = ${JSON.stringify(priceId)};
    const successUrl = ${JSON.stringify(successUrl)};
    const token = ${JSON.stringify(this.clientToken)};
    const environment = ${JSON.stringify(env)};
    if (!token || !priceId) {
      document.querySelector(".text").textContent = ${JSON.stringify(copy.err)};
    } else {
      Paddle.Environment.set(environment);
      Paddle.Initialize({
        token,
        eventCallback: (event) => {
          if (event.name === "checkout.error" || event.name === "checkout.payment-error") {
            console.error("[PADDLE]", event.name, event.data);
          }
        },
      });
      Paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        ${emailPrefill}
        settings: {
          variant: "one-page",
          successUrl,
          sourcePage: window.location.href,
        },
      });
    }
  </script>
</body>
</html>`;
  }

  renderSuccessPage(lang: 'vi' | 'en'): string {
    const copy = lang === 'vi'
      ? { ok: 'Thanh toán thành công!', sub: 'Bạn có thể quay lại ứng dụng' }
      : { ok: 'Payment successful!', sub: 'You can return to the app now' };
    return `<!doctype html>
<html lang="${lang}">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Clipy</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .card { text-align: center; padding: 24px; }
  .ok { font-size: 18px; font-weight: 600; margin-top: 12px; }
  .sub { font-size: 14px; opacity: .7; margin-top: 6px; }
</style>
</head>
<body>
  <div class="card">
    <div class="ok">${copy.ok}</div>
    <div class="sub">${copy.sub}</div>
  </div>
  <script>document.body.style.background=window.matchMedia("(prefers-color-scheme: dark)").matches?"#18181b":"#ffffff";document.body.style.color=window.matchMedia("(prefers-color-scheme: dark)").matches?"#fafafa":"#18181b";</script>
</body>
</html>`;
  }

  verifyWebhook(rawBody: string, signature: string) {
    if (!this.paddle) {
      throw new ServiceUnavailableException('Paddle is not configured on the server');
    }
    const secret = this.config.get<string>('PADDLE_WEBHOOK_SECRET') ?? '';
    return this.paddle.webhooks.unmarshal(rawBody, secret, signature);
  }

  async getStatus(email: string): Promise<{ subscription: SubscriptionStatus | null }> {
    const customer = await this.customersRepo.findOneBy({ email: email.toLowerCase() });
    if (!customer) {
      return { subscription: null };
    }
    const subs = await this.subsRepo.find({
      where: { customerId: customer.customerId },
      order: { createdAt: 'DESC' },
      take: 1,
    });
    const sub = subs[0];
    return {
      subscription: sub
        ? {
            status: sub.status,
            scheduledChange: sub.scheduledChange,
            priceId: sub.priceId,
            productId: sub.productId,
          }
        : null,
    };
  }

  async createPortalSession(email: string): Promise<{ url: string }> {
    if (!this.paddle) {
      throw new ServiceUnavailableException('Paddle is not configured on the server');
    }
    const customer = await this.customersRepo.findOneBy({ email: email.toLowerCase() });
    if (!customer) {
      throw new NotFoundException('No Paddle customer for this account');
    }
    const subs = await this.subsRepo.find({
      where: { customerId: customer.customerId },
    });
    const session = await this.paddle.customerPortalSessions.create(
      customer.customerId,
      subs.map((s) => s.subscriptionId),
    );
    return { url: session.urls.general.overview };
  }

  async getCustomerByEmail(email: string): Promise<PaddleCustomer | null> {
    return this.customersRepo.findOneBy({ email: email.toLowerCase() });
  }

  async getCustomerById(customerId: string): Promise<{ id: string; email: string } | null> {
    if (!this.paddle) {
      return null;
    }
    try {
      const customer = await this.paddle.customers.get(customerId);
      return customer ? { id: customer.id, email: customer.email } : null;
    } catch (e) {
      this.logger.warn(`Failed to fetch customer ${customerId}: ${String(e)}`);
      return null;
    }
  }

  async getSubscriptionsByCustomer(customerId: string): Promise<PaddleSubscription[]> {
    return this.subsRepo.find({
      where: { customerId },
      order: { createdAt: 'DESC' },
    });
  }
}

export interface SubscriptionStatus {
  status: string;
  scheduledChange: Date | null;
  priceId: string;
  productId: string;
}