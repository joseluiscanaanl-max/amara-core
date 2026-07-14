import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';

@Module({
  imports: [CommonModule],
  controllers: [ProductionController],
  providers: [ProductionService],
})
export class ProductionModule {}
