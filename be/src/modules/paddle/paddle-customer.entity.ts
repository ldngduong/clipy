import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('paddle_customers')
export class PaddleCustomer {
  @PrimaryColumn({ name: 'customer_id', type: 'varchar' })
  customerId: string;

  @Column({ type: 'varchar' })
  email: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}