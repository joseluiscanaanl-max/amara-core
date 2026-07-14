import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { QualityController } from './quality.controller';
import { QualityService } from './quality.service';

@Module({
  imports: [CommonModule],
  controllers: [QualityController],
  providers: [QualityService],
})
export class QualityModule {}
