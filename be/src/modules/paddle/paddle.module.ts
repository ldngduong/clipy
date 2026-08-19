import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { PaddleController } from './paddle.controller';
import { PaddleService } from './paddle.service';
import { WebhookService } from './webhook.service';
import { PaddleCustomer } from './paddle-customer.entity';
import { PaddleSubscription } from './paddle-subscription.entity';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([PaddleCustomer, PaddleSubscription]),
  ],
  controllers: [PaddleController],
  providers: [PaddleService, WebhookService],
  exports: [PaddleService],
})
export class PaddleModule {}