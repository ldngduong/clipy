import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { RefreshTokenPayload } from '../tokens.service';
import { UsersService } from '../../users/users.service';

interface RefreshRequest extends Request {
  body: { refreshToken?: string };
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: (req: RefreshRequest) => {
        const token = req.body?.refreshToken;
        if (!token) {
          throw new UnauthorizedException('Missing refresh token');
        }
        return token;
      },
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
    });
  }

  async validate(payload: RefreshTokenPayload) {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return { user, jti: payload.jti };
  }
}