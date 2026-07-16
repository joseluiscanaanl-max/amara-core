import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  JwtService,
  type JwtSignOptions,
} from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import type { GeneratedTokens } from '../../domain/interfaces/generated-tokens.interface';
import type { TokenPayload } from '../../domain/interfaces/token-payload.interface';

@Injectable()
export class TokenService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessExpiresIn: JwtSignOptions['expiresIn'];
  private readonly refreshExpiresIn: JwtSignOptions['expiresIn'];

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.accessSecret =
      this.configService.get<string>('JWT_ACCESS_SECRET') ??
      'change-access-secret';

    this.refreshSecret =
      this.configService.get<string>('JWT_REFRESH_SECRET') ??
      'change-refresh-secret';

    this.accessExpiresIn =
      (this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ??
        '15m') as JwtSignOptions['expiresIn'];

    this.refreshExpiresIn =
      (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ??
        '30d') as JwtSignOptions['expiresIn'];
  }

  async generateTokens(
    userId: string,
    phone: string,
  ): Promise<GeneratedTokens> {
    const sessionId = randomUUID();

    const payload: TokenPayload = {
      sub: userId,
      phone,
      sessionId,
    };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.accessSecret,
      expiresIn: this.accessExpiresIn,
    });

    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.refreshSecret,
      expiresIn: this.refreshExpiresIn,
    });

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresIn: this.accessExpiresIn,
      refreshTokenExpiresIn: this.refreshExpiresIn,
      refreshTokenExpiresAt: new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ),
  refreshTokenHash: this.hashRefreshToken(refreshToken),
  sessionId,
    };
  }

  async verifyAccessToken(
    token: string,
  ): Promise<TokenPayload> {
    return this.jwtService.verifyAsync<TokenPayload>(token, {
      secret: this.accessSecret,
    });
  }

  async verifyRefreshToken(
    token: string,
  ): Promise<TokenPayload> {
    return this.jwtService.verifyAsync<TokenPayload>(token, {
      secret: this.refreshSecret,
    });
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256')
      .update(token)
      .digest('hex');
  }
}