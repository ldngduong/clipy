import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('paddle_subscriptions')
export class PaddleSubscription {
  @PrimaryColumn({ name: 'subscription_id', type: 'varchar' })
  subscriptionId: string;

  @Column({ name: 'customer_id', type: 'varchar' })
  customerId: string;

  @Column({ type: 'varchar' })
  status: string;

  @Column({ name: 'price_id', type: 'varchar' })
  priceId: string;

  @Column({ name: 'product_id', type: 'varchar' })
  productId: string;

  @Column({ name: 'scheduled_change', type: 'timestamp', nullable: true })
  scheduledChange: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}