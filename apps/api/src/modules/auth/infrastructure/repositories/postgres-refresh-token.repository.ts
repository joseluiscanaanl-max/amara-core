import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../common/database/database.service';
import type {
  CreateRefreshTokenInput,
  RefreshTokenRepository,
} from '../../domain/repositories/refresh-token.repository';

@Injectable()
export class PostgresRefreshTokenRepository
  implements RefreshTokenRepository
{
  constructor(private readonly database: DatabaseService) {}

  async create(input: CreateRefreshTokenInput): Promise<void> {
    await this.database.query(
      `
        INSERT INTO identity.refresh_tokens (
          id,
          user_id,
          token_hash,
          device_name,
          device_os,
          ip_address,
          user_agent,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        input.id,
        input.userId,
        input.tokenHash,
        input.deviceName ?? null,
        input.deviceOs ?? null,
        input.ipAddress ?? null,
        input.userAgent ?? null,
        input.expiresAt,
      ],
    );
  }
}