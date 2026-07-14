import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { QualityService } from './quality.service';

class OpenInspectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  inspectorUserCode?: string;
}

class RecordCheckDto {
  @IsString()
  @MaxLength(60)
  checkCode!: string;

  @IsIn(['PASS', 'FAIL', 'NOT_APPLICABLE'])
  result!: 'PASS' | 'FAIL' | 'NOT_APPLICABLE';

  @IsOptional()
  @IsNumber()
  numericValue?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  textValue?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  unitCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsObject()
  evidence?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  checkedByUserCode?: string;
}

class DecideInspectionDto {
  @IsIn(['APPROVE', 'PARTIAL_RELEASE', 'REJECT', 'HOLD'])
  decision!: 'APPROVE' | 'PARTIAL_RELEASE' | 'REJECT' | 'HOLD';

  @IsOptional()
  @IsInt()
  @Min(0)
  approvedQuantity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  rejectedQuantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  inspectorUserCode?: string;
}

@Controller('quality')
export class QualityController {
  constructor(private readonly service: QualityService) {}

  @Get('lots')
  listLots(
    @Query('cppCode') cppCode?: string,
    @Query('serviceDate') serviceDate?: string,
    @Query('status') status?: string,
  ) {
    return this.service.listLots({ cppCode, serviceDate, status });
  }

  @Get('lots/:lotCode')
  getLot(@Param('lotCode') lotCode: string) {
    return this.service.getLot(lotCode);
  }

  @Post('lots/:lotCode/inspections')
  openInspection(@Param('lotCode') lotCode: string, @Body() dto: OpenInspectionDto) {
    return this.service.openInspection(lotCode, dto);
  }

  @Get('inspections/:inspectionCode')
  getInspection(@Param('inspectionCode') inspectionCode: string) {
    return this.service.getInspection(inspectionCode);
  }

  @Post('inspections/:inspectionCode/checks')
  recordCheck(@Param('inspectionCode') inspectionCode: string, @Body() dto: RecordCheckDto) {
    return this.service.recordCheck(inspectionCode, dto);
  }

  @Post('inspections/:inspectionCode/decision')
  decide(@Param('inspectionCode') inspectionCode: string, @Body() dto: DecideInspectionDto) {
    return this.service.decide(inspectionCode, dto);
  }
}
