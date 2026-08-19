import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService, TokenPair } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleExchangeDto, RefreshTokenDto } from './dto/tokens.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard, JwtRefreshGuard } from '../../common/guards/auth.guards';
import { User } from '../users/user.entity';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new account' })
  register(@Body() dto: RegisterDto): Promise<TokenPair> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  login(@Body() dto: LoginDto): Promise<TokenPair> {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @UseGuards(JwtRefreshGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate access and refresh tokens' })
  refresh(
    @CurrentUser('user') user: User,
    @Body() dto: RefreshTokenDto,
  ): Promise<TokenPair> {
    return this.authService.refresh(user, dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the refresh token' })
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }

  @Get('google/url')
  @ApiOperation({ summary: 'Get Google OAuth consent URL' })
  googleConsentUrl(
    @Query('lang') lang?: string,
    @Query('port') port?: string,
  ): Promise<{ url: string }> {
    return this.authService.googleConsentUrl(lang, port ? Number(port) : undefined);
  }

  @Post('google/exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange Google OAuth code for tokens' })
  googleExchange(@Body() dto: GoogleExchangeDto): Promise<TokenPair> {
    return this.authService.googleExchange(dto.code);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current user profile' })
  me(@CurrentUser() user: User): User {
    return user;
  }
}