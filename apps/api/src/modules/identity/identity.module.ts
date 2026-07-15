import { Module } from '@nestjs/common';
import { IdentityController } from './controllers/identity.controller';
import { IdentityService } from './application/services/identity.service';

@Module({
  controllers: [IdentityController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}