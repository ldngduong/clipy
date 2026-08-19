import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { compare, hash } from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { TokensService } from './tokens.service';
import { GoogleService } from './google.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tokensService: TokensService,
    private readonly googleService: GoogleService,
  ) {}

  async register(dto: RegisterDto): Promise<TokenPair> {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      throw new ConflictException('Email is already registered');
    }
    const passwordHash = await hash(dto.password, 10);
    const user = await this.usersService.create({
      email,
      passwordHash,
      displayName: dto.displayName?.trim() || email.split('@')[0],
    });
    return this.tokensService.issueTokenPair(user);
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.usersService.findByEmail(email);
    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const valid = await compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.tokensService.issueTokenPair(user);
  }

  async refresh(user: User, refreshToken: string): Promise<TokenPair> {
    const newRefreshToken = await this.tokensService.rotate(refreshToken, user);
    return {
      accessToken: this.tokensService.signAccessToken(user),
      refreshToken: newRefreshToken,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokensService.revoke(refreshToken);
  }

  async googleConsentUrl(lang?: string, port?: number): Promise<{ url: string }> {
    if (!this.googleService.isEnabled) {
      throw new BadRequestException('Google OAuth is not configured on the server');
    }
    const hl = lang === 'vi' || lang === 'en' ? lang : undefined;
    const state = this.randomState();
    return { url: this.googleService.buildConsentUrl(state, hl, port) };
  }

  async googleExchange(code: string): Promise<TokenPair> {
    const info = await this.googleService.exchangeCode(code);
    let user = await this.usersService.findByGoogleId(info.id);

    if (!user) {
      const email = info.email?.toLowerCase().trim();
      const emailOwner = email ? await this.usersService.findByEmail(email) : null;
      if (emailOwner) {
        user = await this.usersService.linkGoogleId(emailOwner.id, info.id);
      } else {
        user = await this.usersService.create({
          email: email || `google-${info.id}@localhost`,
          googleId: info.id,
          passwordHash: null,
          displayName: info.name || email?.split('@')[0] || 'Google user',
          avatarUrl: info.picture || null,
        });
      }
    }

    return this.tokensService.issueTokenPair(user);
  }

  private randomState(): string {
    return randomBytes(24).toString('hex');
  }

  async getUserById(userId: string): Promise<User> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Invalid user');
    }
    return user;
  }
}