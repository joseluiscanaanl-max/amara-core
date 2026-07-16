import { Module } from '@nestjs/common';
import { IdentityService } from './application/services/identity.service';
import { IdentityController } from './controllers/identity.controller';
import { OTP_CHALLENGE_REPOSITORY } from './domain/repositories/otp-challenge.repository';
import { USER_REPOSITORY } from './domain/repositories/user.repository';
import { PostgresOtpChallengeRepository } from './infrastructure/repositories/postgres-otp-challenge.repository';
import { PostgresUserRepository } from './infrastructure/repositories/postgres-user.repository';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [IdentityController],
  providers: [
    IdentityService,
    PostgresOtpChallengeRepository,
    PostgresUserRepository,
    {
      provide: OTP_CHALLENGE_REPOSITORY,
      useExisting: PostgresOtpChallengeRepository,
    },
    {
      provide: USER_REPOSITORY,
      useExisting: PostgresUserRepository,
    },
  ],
  exports: [IdentityService],
})
export class IdentityModule {}