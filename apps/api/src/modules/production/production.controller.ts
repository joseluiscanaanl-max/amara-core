import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ProductionService } from './production.service';

class StartProductionOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  responsibleUserCode?: string;

  @IsOptional()
  @IsString()
  scheduledStartAt?: string;
}

class CompleteProductionOrderDto {
  @IsInt()
  @Min(1)
  actualQuantity!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  wasteQuantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  wasteReasonCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;
}

@Controller('production')
export class ProductionController {
  constructor(private readonly service: ProductionService) {}

  @Post('master-orders/:ompCode/release')
  release(@Param('ompCode') ompCode: string) {
    return this.service.releaseMasterOrder(ompCode);
  }

  @Get('orders')
  list(
    @Query('cppCode') cppCode?: string,
    @Query('serviceDate') serviceDate?: string,
    @Query('status') status?: string,
  ) {
    return this.service.listOrders({ cppCode, serviceDate, status });
  }

  @Get('orders/:productionOrderCode')
  get(@Param('productionOrderCode') productionOrderCode: string) {
    return this.service.getOrder(productionOrderCode);
  }

  @Post('orders/:productionOrderCode/start')
  start(
    @Param('productionOrderCode') productionOrderCode: string,
    @Body() dto: StartProductionOrderDto,
  ) {
    return this.service.startOrder(productionOrderCode, dto);
  }

  @Post('orders/:productionOrderCode/complete')
  complete(
    @Param('productionOrderCode') productionOrderCode: string,
    @Body() dto: CompleteProductionOrderDto,
  ) {
    return this.service.completeOrder(productionOrderCode, dto);
  }

  @Get('lots/:lotCode')
  getLot(@Param('lotCode') lotCode: string) {
    return this.service.getLot(lotCode);
  }
}
