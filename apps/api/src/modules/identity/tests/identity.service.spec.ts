import { ConfigService } from '@nestjs/config';
import { IdentityService } from '../application/services/identity.service';
import type {
  CreateOtpChallengeInput,
  OtpChallengeRepository,
  OtpPurpose,
  StoredOtpChallenge,
} from '../domain/repositories/otp-challenge.repository';
import type {
  CreateIdentityUserInput,
  IdentityUser,
  UserRepository,
} from '../domain/repositories/user.repository';

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

class InMemoryUserRepository implements UserRepository {
  readonly users = new Map<string, IdentityUser>();

  async findByPhone(
    phone: string,
  ): Promise<IdentityUser | null> {
    return this.users.get(phone) ?? null;
  }

  async create(
    input: CreateIdentityUserInput,
  ): Promise<IdentityUser> {
    const now = new Date();

    const user: IdentityUser = {
      id: input.id,
      phone: input.phone,
      status: input.status,
      firstName: null,
      lastName: null,
      email: null,
      createdAt: now,
      updatedAt: now,
    };

    this.users.set(input.phone, user);

    return user;
  }
}

function createSessionServiceMock() {
  return {
    createSession: jest.fn().mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessTokenExpiresIn: '15m',
      refreshTokenExpiresIn: '30d',
      sessionId: 'session-id',
    }),
  };
}

describe('IdentityService', () => {
  it(
    'creates a user and session after verifying a registration OTP',
    async () => {
      const otpRepository = new InMemoryOtpRepository();
      const userRepository = new InMemoryUserRepository();
      const sessionService = createSessionServiceMock();

      const configService = new ConfigService({
        OTP_PEPPER: 'test-pepper',
        OTP_DEVELOPMENT_ECHO: 'true',
      });

      const service = new IdentityService(
        otpRepository,
        userRepository,
        sessionService as never,
        configService,
      );

      const requested = await service.requestOtp({
        phone: '+528331234567',
        purpose: 'REGISTRATION',
      });

      const verified = await service.verifyOtp({
        challengeId: requested.data.challengeId,
        code: requested.data.developmentCode!,
      });

      expect(verified.data.status).toBe('OTP_VERIFIED');

      expect(verified.data.user).toEqual(
        expect.objectContaining({
          phone: '+528331234567',
          status: 'ACTIVE',
        }),
      );

      expect(verified.data.session).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresIn: '15m',
        refreshTokenExpiresIn: '30d',
        sessionId: 'session-id',
      });

      expect(userRepository.users.size).toBe(1);

      expect(sessionService.createSession).toHaveBeenCalledWith(
        verified.data.user.id,
        '+528331234567',
      );
    },
  );

  it(
    'reuses the existing user on a later registration verification',
    async () => {
      const otpRepository = new InMemoryOtpRepository();
      const userRepository = new InMemoryUserRepository();
      const sessionService = createSessionServiceMock();

      const configService = new ConfigService({
        OTP_PEPPER: 'test-pepper',
        OTP_DEVELOPMENT_ECHO: 'true',
      });

      const service = new IdentityService(
        otpRepository,
        userRepository,
        sessionService as never,
        configService,
      );

      const firstRequest = await service.requestOtp({
        phone: '+528331234567',
        purpose: 'REGISTRATION',
      });

      const firstVerification = await service.verifyOtp({
        challengeId: firstRequest.data.challengeId,
        code: firstRequest.data.developmentCode!,
      });

      const secondRequest = await service.requestOtp({
        phone: '+528331234567',
        purpose: 'REGISTRATION',
      });

      const secondVerification = await service.verifyOtp({
        challengeId: secondRequest.data.challengeId,
        code: secondRequest.data.developmentCode!,
      });

      expect(secondVerification.data.user.id).toBe(
        firstVerification.data.user.id,
      );

      expect(userRepository.users.size).toBe(1);

      expect(sessionService.createSession).toHaveBeenCalledTimes(2);
    },
  );
});