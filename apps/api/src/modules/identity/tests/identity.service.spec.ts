import { ConfigService } from '@nestjs/config';
import { IdentityService } from '../application/services/identity.service';
import {
  CreateOtpChallengeInput,
  OtpChallengeRepository,
  OtpPurpose,
  StoredOtpChallenge,
} from '../domain/repositories/otp-challenge.repository';

class InMemoryOtpRepository implements OtpChallengeRepository {
  readonly records = new Map<string, StoredOtpChallenge>();

  async invalidateActive(
    phone: string,
    purpose: OtpPurpose,
  ): Promise<void> {
    for (const record of this.records.values()) {
      if (
        record.phone === phone &&
        record.purpose === purpose &&
        !record.verifiedAt
      ) {
        record.expiresAt = new Date(0);
      }
    }
  }

  async create(input: CreateOtpChallengeInput): Promise<void> {
    this.records.set(input.id, {
      ...input,
      attempts: 0,
      verifiedAt: null,
      createdAt: new Date(),
    });
  }

  async findByIdForUpdate(
    id: string,
  ): Promise<StoredOtpChallenge | null> {
    return this.records.get(id) ?? null;
  }

  async incrementAttempts(id: string): Promise<number> {
    const record = this.records.get(id);

    if (!record) {
      return 0;
    }

    record.attempts += 1;
    return record.attempts;
  }

  async markVerified(
    id: string,
    verifiedAt: Date,
  ): Promise<void> {
    const record = this.records.get(id);

    if (record) {
      record.verifiedAt = verifiedAt;
    }
  }
}

describe('IdentityService', () => {
  it('creates and verifies an OTP challenge', async () => {
    const repository = new InMemoryOtpRepository();

    const configService = new ConfigService({
      OTP_PEPPER: 'test-pepper',
      OTP_DEVELOPMENT_ECHO: 'true',
    });

    const service = new IdentityService(
      repository,
      configService,
    );

    const requested = await service.requestOtp({
      phone: '+528331234567',
      purpose: 'REGISTRATION',
    });

    expect(requested.success).toBe(true);
    expect(requested.data.developmentCode).toMatch(/^\d{6}$/);

    const verified = await service.verifyOtp({
      challengeId: requested.data.challengeId,
      code: requested.data.developmentCode!,
    });

    expect(verified.data.status).toBe('OTP_VERIFIED');
  });
});