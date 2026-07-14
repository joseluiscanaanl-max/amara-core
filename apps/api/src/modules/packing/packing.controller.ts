import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PackingService } from './packing.service';

class StartPackingDto {
  @IsOptional() @IsString() @MaxLength(80)
  responsibleUserCode?: string;
}

class AllocateLotDto {
  @IsString() @MaxLength(30)
  lotCode!: string;

  @IsInt() @Min(1)
  quantity!: number;

  @IsOptional() @IsString() @MaxLength(30)
  memberCode?: string;

  @IsOptional() @IsString() @MaxLength(80)
  allocatedByUserCode?: string;
}

class ChecklistDto {
  @IsString() @MaxLength(60)
  checkCode!: string;

  @IsIn(['PASS', 'FAIL', 'NOT_APPLICABLE'])
  result!: 'PASS' | 'FAIL' | 'NOT_APPLICABLE';

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;

  @IsOptional() @IsObject()
  evidence?: Record<string, unknown>;

  @IsOptional() @IsString() @MaxLength(80)
  checkedByUserCode?: string;
}

class ClosePackingDto {
  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;

  @IsOptional() @IsString() @MaxLength(80)
  responsibleUserCode?: string;
}

@Controller('packing')
export class PackingController {
  constructor(private readonly service: PackingService) {}

  @Post('orders/from-order/:orderCode')
  createFromOrder(@Param('orderCode') orderCode: string) {
    return this.service.createFromOrder(orderCode);
  }

  @Get('orders')
  list(
    @Query('cppCode') cppCode?: string,
    @Query('serviceDate') serviceDate?: string,
    @Query('status') status?: string,
  ) {
    return this.service.list({ cppCode, serviceDate, status });
  }

  @Get('orders/:packingOrderCode')
  get(@Param('packingOrderCode') packingOrderCode: string) {
    return this.service.get(packingOrderCode);
  }

  @Post('orders/:packingOrderCode/start')
  start(@Param('packingOrderCode') packingOrderCode: string, @Body() dto: StartPackingDto) {
    return this.service.start(packingOrderCode, dto);
  }

  @Post('orders/:packingOrderCode/items/:packingItemId/allocate')
  allocate(
    @Param('packingOrderCode') packingOrderCode: string,
    @Param('packingItemId') packingItemId: string,
    @Body() dto: AllocateLotDto,
  ) {
    return this.service.allocateLot(packingOrderCode, packingItemId, dto);
  }

  @Post('orders/:packingOrderCode/checks')
  recordCheck(@Param('packingOrderCode') packingOrderCode: string, @Body() dto: ChecklistDto) {
    return this.service.recordCheck(packingOrderCode, dto);
  }

  @Post('orders/:packingOrderCode/close')
  close(@Param('packingOrderCode') packingOrderCode: string, @Body() dto: ClosePackingDto) {
    return this.service.close(packingOrderCode, dto);
  }
}
