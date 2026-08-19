import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email?: boolean;
  name?: string;
  picture?: string;
}

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  expires_in: number;
  token_type: string;
}

@Injectable()
export class GoogleService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.clientId = this.configService.getOrThrow<string>('GOOGLE_CLIENT_ID');
    this.clientSecret = this.configService.getOrThrow<string>('GOOGLE_CLIENT_SECRET');
    this.redirectUri = this.configService.getOrThrow<string>('GOOGLE_REDIRECT_URI');
    this.enabled = Boolean(this.clientId && this.clientSecret);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  buildConsentUrl(state: string, hl?: string, port?: number): string {
    if (!this.enabled) {
      throw new ServiceUnavailableException('Google OAuth is not configured');
    }
    let redirectUri = this.redirectUri;
    if (port !== undefined) {
      const fallbackPorts = [14100, 14101, 14102];
      if (!fallbackPorts.includes(port)) {
        throw new ServiceUnavailableException('Invalid OAuth callback port');
      }
      redirectUri = `http://localhost:${port}/callback`;
    }
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    if (hl) params.set('hl', hl);
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<GoogleUserInfo> {
    if (!this.enabled) {
      throw new ServiceUnavailableException('Google OAuth is not configured');
    }
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
    });

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!tokenResponse.ok) {
      throw new ServiceUnavailableException(
        `Google token exchange failed: ${tokenResponse.status}`,
      );
    }
    const tokenData = (await tokenResponse.json()) as GoogleTokenResponse;

    const userInfoResponse = await fetch(
      `https://www.googleapis.com/oauth2/v2/userinfo?alt=json&access_token=${encodeURIComponent(tokenData.access_token)}`,
    );
    if (!userInfoResponse.ok) {
      throw new ServiceUnavailableException('Failed to fetch Google user info');
    }
    return (await userInfoResponse.json()) as GoogleUserInfo;
  }
}