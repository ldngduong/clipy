import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  EventEntity,
  EventName,
  type Customer,
  type Subscription,
} from '@paddle/paddle-node-sdk';
import { UsersService } from '../users/users.service';
import { PaddleCustomer } from './paddle-customer.entity';
import { PaddleSubscription } from './paddle-subscription.entity';
import { PaddleService } from './paddle.service';

const PRO_STATUSES = new Set(['active', 'trialing', 'past_due']);

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly paddleService: PaddleService,
    private readonly usersService: UsersService,
    @InjectRepository(PaddleCustomer)
    private readonly customersRepo: Repository<PaddleCustomer>,
    @InjectRepository(PaddleSubscription)
    private readonly subsRepo: Repository<PaddleSubscription>,
  ) {}

  async process(event: EventEntity): Promise<void> {
    switch (event.eventType) {
      case EventName.CustomerCreated:
      case EventName.CustomerUpdated:
        await this.upsertCustomer(event.data as Customer);
        return;
      case EventName.SubscriptionCreated:
      case EventName.SubscriptionUpdated:
      case EventName.SubscriptionCanceled:
      case EventName.SubscriptionPastDue:
      case EventName.SubscriptionPaused:
      case EventName.SubscriptionResumed:
      case EventName.SubscriptionActivated:
      case EventName.SubscriptionTrialing:
        await this.upsertSubscription(event.data as Subscription);
        return;
      default:
        return;
    }
  }

  private async upsertCustomer(data: Customer): Promise<void> {
    const email = (data.email ?? '').toLowerCase();
    if (!email) {
      this.logger.warn(`Customer event without email: ${data.id}`);
      return;
    }
    await this.customersRepo.upsert({ customerId: data.id, email }, ['customerId']);
  }

  private async upsertSubscription(data: Subscription): Promise<void> {
    const firstItem = data.items?.[0];
    const scheduledChange = data.scheduledChange?.effectiveAt ?? null;

    await this.subsRepo.upsert(
      {
        subscriptionId: data.id,
        customerId: data.customerId,
        status: data.status,
        priceId: firstItem?.price?.id ?? '',
        productId: firstItem?.price?.productId ?? '',
        scheduledChange,
      },
      ['subscriptionId'],
    );

    const email = await this.resolveCustomerEmail(data.customerId);
    if (!email) {
      return;
    }
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      return;
    }
    const plan: 'free' | 'pro' = PRO_STATUSES.has(data.status) ? 'pro' : 'free';
    if (user.plan !== plan) {
      await this.usersService.updatePlan(user.id, plan);
      this.logger.log(`Plan updated for ${email}: ${user.plan} -> ${plan} (sub ${data.id})`);
    }
  }

  private async resolveCustomerEmail(customerId: string): Promise<string | null> {
    const row = await this.customersRepo.findOneBy({ customerId });
    if (row?.email) {
      return row.email;
    }
    const customer = await this.paddleService.getCustomerById(customerId);
    if (customer?.email) {
      const email = customer.email.toLowerCase();
      await this.customersRepo.upsert({ customerId, email }, ['customerId']);
      return email;
    }
    return null;
  }
}