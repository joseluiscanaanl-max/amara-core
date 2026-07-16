import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../common/database/database.service';
import {
  CreateOtpChallengeInput,
  OtpChallengeRepository,
  OtpPurpose,
  StoredOtpChallenge,
} from '../../domain/repositories/otp-challenge.repository';

interface OtpChallengeRow {
  id: string;
  phone_e164: string;
  purpose_code: OtpPurpose;
  secret_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: Date;
  verified_at: Date | null;
  created_at: Date;
}

@Injectable()
export class PostgresOtpChallengeRepository implements OtpChallengeRepository {
  constructor(private readonly database: DatabaseService) {}

  async invalidateActive(phone: string, purpose: OtpPurpose): Promise<void> {
    await this.database.query(
      `UPDATE identity.otp_challenges
       SET invalidated_at = NOW()
       WHERE phone_e164 = $1
         AND purpose_code = $2
         AND verified_at IS NULL
         AND invalidated_at IS NULL
         AND expires_at > NOW()`,
      [phone, purpose],
    );
  }

  async create(input: CreateOtpChallengeInput): Promise<void> {
    await this.database.query(
      `INSERT INTO identity.otp_challenges (
         id, phone_e164, purpose_code, secret_hash,
         attempts, max_attempts, expires_at
       ) VALUES ($1, $2, $3, $4, 0, $5, $6)`,
      [
        input.id,
        input.phone,
        input.purpose,
        input.secretHash,
        input.maxAttempts,
        input.expiresAt,
      ],
    );
  }

  async findByIdForUpdate(id: string): Promise<StoredOtpChallenge | null> {
    const result = await this.database.query<OtpChallengeRow>(
      `SELECT id, phone_e164, purpose_code, secret_hash,
              attempts, max_attempts, expires_at,
              verified_at, created_at
       FROM identity.otp_challenges
       WHERE id = $1 AND invalidated_at IS NULL`,
      [id],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      phone: row.phone_e164,
      purpose: row.purpose_code,
      secretHash: row.secret_hash,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      expiresAt: row.expires_at,
      verifiedAt: row.verified_at,
      createdAt: row.created_at,
    };
  }

  async incrementAttempts(id: string): Promise<number> {
    const result = await this.database.query<{ attempts: number }>(
      `UPDATE identity.otp_challenges
       SET attempts = attempts + 1
       WHERE id = $1
       RETURNING attempts`,
      [id],
    );

    return result.rows[0]?.attempts ?? 0;
  }

  async markVerified(id: string, verifiedAt: Date): Promise<void> {
    await this.database.query(
      `UPDATE identity.otp_challenges
       SET verified_at = $2
       WHERE id = $1`,
      [id, verifiedAt],
    );
  }
}