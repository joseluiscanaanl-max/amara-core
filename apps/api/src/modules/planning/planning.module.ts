import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';

@Module({
  imports: [CommonModule],
  controllers: [PlanningController],
  providers: [PlanningService],
})
export class PlanningModule {}
