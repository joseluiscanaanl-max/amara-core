export interface CreateRefreshTokenInput {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  deviceName?: string | null;
  deviceOs?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export const REFRESH_TOKEN_REPOSITORY = Symbol(
  'REFRESH_TOKEN_REPOSITORY',
);

export interface RefreshTokenRepository {
  create(input: CreateRefreshTokenInput): Promise<void>;
}