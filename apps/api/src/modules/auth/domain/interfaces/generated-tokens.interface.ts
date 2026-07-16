import type { JwtSignOptions } from '@nestjs/jwt';

export interface GeneratedTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: JwtSignOptions['expiresIn'];
  refreshTokenExpiresIn: JwtSignOptions['expiresIn'];
  refreshTokenExpiresAt: Date;
  refreshTokenHash: string;
  sessionId: string;
}