import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/auth.guards';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { PaddleService } from './paddle.service';
import { WebhookService } from './webhook.service';

@ApiTags('paddle')
@Controller('paddle')
export class PaddleController {
  private readonly logger = new Logger(PaddleController.name);

  constructor(
    private readonly paddleService: PaddleService,
    private readonly webhookService: WebhookService,
  ) {}

  @Post('webhook')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive Paddle webhook events' })
  async webhook(@Req() req: Request): Promise<{ received: boolean }> {
    const signature = req.headers['paddle-signature'];
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody?.toString('utf8') ?? '';
    if (!signature || !rawBody) {
      throw new BadRequestException('Missing signature or body');
    }
    try {
      const event = await this.paddleService.verifyWebhook(rawBody, signature as string);
      if (event) {
        await this.webhookService.process(event);
      }
      return { received: true };
    } catch (e) {
      this.logger.error(`Webhook verification failed: ${String(e)}`);
      throw new BadRequestException('Invalid Paddle signature');
    }
  }

  @Get('catalog')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Paddle checkout info for the frontend (client token + price IDs)' })
  catalog(): {
    environment: string;
    clientToken: string;
    prices: { monthly: string; yearly: string };
    checkoutUrl: { monthly: string; yearly: string };
  } {
    return {
      environment: this.paddleService.environment === 'production' ? 'production' : 'sandbox',
      clientToken: this.paddleService.clientToken,
      prices: {
        monthly: this.paddleService.monthlyPriceId,
        yearly: this.paddleService.yearlyPriceId,
      },
      checkoutUrl: {
        monthly: this.paddleService.buildCheckoutUrl('monthly'),
        yearly: this.paddleService.buildCheckoutUrl('yearly'),
      },
    };
  }

  @Get('checkout')
  @ApiOperation({ summary: 'Hosted Paddle checkout page (loads from the approved checkout domain)' })
  checkout(
    @Query('plan') plan?: string,
    @Query('email') email?: string,
    @Query('lang') lang?: string,
    @Res() res?: Response,
  ): void {
    res
      ?.setHeader('Cache-Control', 'no-store')
      .type('html')
      .send(
        this.paddleService.renderCheckoutPage({
          plan: plan === 'yearly' ? 'yearly' : 'monthly',
          email: typeof email === 'string' ? email.slice(0, 254) : '',
          lang: lang === 'en' ? 'en' : 'vi',
        }),
      );
  }

  @Get('checkout/success')
  @ApiOperation({ summary: 'Post-checkout success page' })
  checkoutSuccess(@Query('lang') lang?: string, @Res() res?: Response): void {
    res
      ?.setHeader('Cache-Control', 'no-store')
      .type('html')
      .send(this.paddleService.renderSuccessPage(lang === 'en' ? 'en' : 'vi'));
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Billing status of the current user' })
  status(@CurrentUser('email') email: string) {
    return this.paddleService.getStatus(email);
  }

  @Post('portal')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mint a Paddle customer portal session URL for the current user' })
  portal(@CurrentUser('email') email: string) {
    return this.paddleService.createPortalSession(email);
  }
}