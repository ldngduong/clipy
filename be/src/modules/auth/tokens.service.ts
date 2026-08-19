import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { RefreshToken } from './refresh-token.entity';
import { User } from '../users/user.entity';

export interface AccessTokenPayload {
  sub: string;
  email: string;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokensRepository: Repository<RefreshToken>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async issueTokenPair(user: User): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = this.signAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user);
    return { accessToken, refreshToken };
  }

  signAccessToken(user: User): string {
    const payload: AccessTokenPayload = { sub: user.id, email: user.email };
    const options: JwtSignOptions = {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.configService.getOrThrow<string>('JWT_ACCESS_EXPIRES') as JwtSignOptions['expiresIn'],
    };
    return this.jwtService.sign(payload, options);
  }

  private async issueRefreshToken(user: User): Promise<string> {
    const token = randomBytes(48).toString('base64url');
    const jti = randomBytes(16).toString('hex');
    const expiresIn = this.configService.getOrThrow<string>('JWT_REFRESH_EXPIRES');
    const ttlSeconds = parseDuration(expiresIn);

    await this.refreshTokensRepository.save(
      this.refreshTokensRepository.create({
        userId: user.id,
        tokenHash: this.hashToken(token),
        jti,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      }),
    );

    return this.jwtService.sign({ sub: user.id, jti } satisfies RefreshTokenPayload, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.getOrThrow<string>('JWT_REFRESH_EXPIRES') as JwtSignOptions['expiresIn'],
    });
  }

  async rotate(refreshToken: string, user: User): Promise<string> {
    const payload = this.verifyRefreshToken(refreshToken);
    const stored = await this.refreshTokensRepository.findOne({
      where: {
        jti: payload.jti,
        revokedAt: IsNull(),
        expiresAt: MoreThanOrEqual(new Date()),
      },
    });

    if (!stored || stored.userId !== user.id) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const revoked = await this.refreshTokensRepository.update(
      { jti: payload.jti, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    if (!revoked.affected) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.issueRefreshToken(user);
  }

  async revoke(refreshToken: string): Promise<void> {
    try {
      const payload = this.verifyRefreshToken(refreshToken);
      await this.refreshTokensRepository.update(
        { jti: payload.jti },
        { revokedAt: new Date() },
      );
    } catch (error) {
      this.logger.warn(`failed to revoke refresh token: ${error}`);
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokensRepository.update({ userId }, { revokedAt: new Date() });
  }

  verifyRefreshToken(refreshToken: string): RefreshTokenPayload {
    try {
      return this.jwtService.verify<RefreshTokenPayload>(refreshToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  cleanupExpired(): Promise<number> {
    return this.refreshTokensRepository
      .createQueryBuilder()
      .delete()
      .from(RefreshToken)
      .where('expires_at < :now', { now: new Date() })
      .execute()
      .then((result) => result.affected ?? 0);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

function parseDuration(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) return 30 * 24 * 60 * 60;
  const amount = Number(match[1]);
  switch (match[2]) {
    case 's':
      return amount;
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 3600;
    case 'd':
      return amount * 86400;
    default:
      return 30 * 24 * 60 * 60;
  }
}