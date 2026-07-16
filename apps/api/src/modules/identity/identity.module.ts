import { Module } from '@nestjs/common';
import { IdentityService } from './application/services/identity.service';
import { IdentityController } from './controllers/identity.controller';
import { OTP_CHALLENGE_REPOSITORY } from './domain/repositories/otp-challenge.repository';
import { PostgresOtpChallengeRepository } from './infrastructure/repositories/postgres-otp-challenge.repository';

@Module({
  controllers: [IdentityController],
  providers: [
    IdentityService,
    PostgresOtpChallengeRepository,
    {
      provide: OTP_CHALLENGE_REPOSITORY,
      useExisting: PostgresOtpChallengeRepository,
    },
  ],
  exports: [IdentityService],
})
export class IdentityModule {}