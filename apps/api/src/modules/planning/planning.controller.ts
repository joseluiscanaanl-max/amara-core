import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsDateString, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { PlanningService } from './planning.service';

class GenerateMasterOrderDto {
  @IsString()
  cppCode!: string;

  @IsDateString()
  serviceDate!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(30)
  strategicReservePercent?: number;
}

@Controller('planning')
export class PlanningController {
  constructor(private readonly service: PlanningService) {}

  @Get('cpp/:cppCode/service-date/:serviceDate/demand')
  demand(@Param('cppCode') cppCode: string, @Param('serviceDate') serviceDate: string) {
    return this.service.previewDemand(cppCode, serviceDate);
  }

  @Post('master-orders/generate')
  generate(@Body() dto: GenerateMasterOrderDto) {
    return this.service.generateMasterOrder(dto);
  }

  @Get('master-orders/:ompCode')
  get(@Param('ompCode') ompCode: string) {
    return this.service.getMasterOrder(ompCode);
  }

  @Post('master-orders/:ompCode/approve')
  approve(@Param('ompCode') ompCode: string) {
    return this.service.approveMasterOrder(ompCode);
  }
}
