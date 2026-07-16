import { Inject, Injectable } from '@nestjs/common';
import type { CreatedSession } from '../../domain/interfaces/created-session.interface';
import {
  REFRESH_TOKEN_REPOSITORY,
} from '../../domain/repositories/refresh-token.repository';
import type {
  RefreshTokenRepository,
} from '../../domain/repositories/refresh-token.repository';
import { TokenService } from './token.service';

@Injectable()
export class SessionService {
  constructor(
    private readonly tokenService: TokenService,

    @Inject(REFRESH_TOKEN_REPOSITORY)
    private readonly refreshTokenRepository: RefreshTokenRepository,
  ) {}

  async createSession(
    userId: string,
    phone: string,
  ): Promise<CreatedSession> {
    const tokens = await this.tokenService.generateTokens(
      userId,
      phone,
    );

    await this.refreshTokenRepository.create({
      id: tokens.sessionId,
      userId,
      tokenHash: tokens.refreshTokenHash,
      expiresAt: tokens.refreshTokenExpiresAt,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresIn: tokens.accessTokenExpiresIn,
      refreshTokenExpiresIn: tokens.refreshTokenExpiresIn,
      sessionId: tokens.sessionId,
    };
  }
}