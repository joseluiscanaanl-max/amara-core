import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../../common/database/database.module';
import { SessionService } from './application/services/session.service';
import { TokenService } from './application/services/token.service';
import { REFRESH_TOKEN_REPOSITORY } from './domain/repositories/refresh-token.repository';
import { PostgresRefreshTokenRepository } from './infrastructure/repositories/postgres-refresh-token.repository';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.register({}),
  ],
  providers: [
    TokenService,
    SessionService,
    PostgresRefreshTokenRepository,
    {
      provide: REFRESH_TOKEN_REPOSITORY,
      useExisting: PostgresRefreshTokenRepository,
    },
  ],
  exports: [
    TokenService,
    SessionService,
  ],
})
export class AuthModule {}