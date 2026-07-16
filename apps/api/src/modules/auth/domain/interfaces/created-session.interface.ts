import type { JwtSignOptions } from '@nestjs/jwt';

export interface CreatedSession {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: JwtSignOptions['expiresIn'];
  refreshTokenExpiresIn: JwtSignOptions['expiresIn'];
  sessionId: string;
}