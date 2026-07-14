import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsArray, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { LogisticsService } from './logistics.service';

class CreateRouteDto {
  @IsString() @MaxLength(24) cppCode!: string;
  @IsString() serviceDate!: string;
  @IsString() deliveryWindowStart!: string;
  @IsString() deliveryWindowEnd!: string;
  @IsOptional() @IsString() @MaxLength(80) hostUserCode?: string;
  @IsOptional() @IsString() @MaxLength(24) vehicleCode?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) maxStops?: number;
  @IsOptional() @IsArray() orderCodes?: string[];
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

class AddStopDto {
  @IsString() @MaxLength(24) orderCode!: string;
  @IsOptional() @IsInt() @Min(1) stopSequence?: number;
  @IsOptional() @IsString() estimatedArrivalAt?: string;
}

class PublishRouteDto {
  @IsOptional() @IsString() @MaxLength(80) hostUserCode?: string;
  @IsOptional() @IsString() @MaxLength(24) vehicleCode?: string;
}

class ArriveDto {
  @IsOptional() @IsNumber() latitude?: number;
  @IsOptional() @IsNumber() longitude?: number;
  @IsOptional() @IsInt() @Min(0) waitingMinutes?: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

class CompleteDeliveryDto {
  @IsString() @MaxLength(150) receiverName!: string;
  @IsIn(['HOUSEHOLD_MEMBER', 'AUTHORIZED_THIRD_PARTY', 'RECEPTION'])
  receiverType!: 'HOUSEHOLD_MEMBER' | 'AUTHORIZED_THIRD_PARTY' | 'RECEPTION';
  @IsOptional() @IsNumber() latitude?: number;
  @IsOptional() @IsNumber() longitude?: number;
  @IsOptional() @IsObject() evidence?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

class FailDeliveryDto {
  @IsString() @MaxLength(60) reasonCode!: string;
  @IsString() @MaxLength(1500) notes!: string;
  @IsOptional() @IsObject() evidence?: Record<string, unknown>;
}

class IncidentDto {
  @IsString() @MaxLength(60) categoryCode!: string;
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  severity!: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  @IsString() @MaxLength(1500) description!: string;
  @IsOptional() @IsObject() evidence?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(80) reportedByUserCode?: string;
}

@Controller('logistics')
export class LogisticsController {
  constructor(private readonly service: LogisticsService) {}

  @Post('routes')
  create(@Body() dto: CreateRouteDto) { return this.service.createRoute(dto); }

  @Get('routes')
  list(@Query('cppCode') cppCode?: string, @Query('serviceDate') serviceDate?: string, @Query('status') status?: string) {
    return this.service.listRoutes({ cppCode, serviceDate, status });
  }

  @Get('routes/:routeCode')
  get(@Param('routeCode') routeCode: string) { return this.service.getRoute(routeCode); }

  @Post('routes/:routeCode/stops')
  addStop(@Param('routeCode') routeCode: string, @Body() dto: AddStopDto) { return this.service.addStop(routeCode, dto); }

  @Post('routes/:routeCode/publish')
  publish(@Param('routeCode') routeCode: string, @Body() dto: PublishRouteDto) { return this.service.publishRoute(routeCode, dto); }

  @Post('routes/:routeCode/start')
  start(@Param('routeCode') routeCode: string) { return this.service.startRoute(routeCode); }

  @Post('routes/:routeCode/stops/:stopId/arrive')
  arrive(@Param('routeCode') routeCode: string, @Param('stopId') stopId: string, @Body() dto: ArriveDto) {
    return this.service.arrive(routeCode, stopId, dto);
  }

  @Post('routes/:routeCode/stops/:stopId/complete')
  complete(@Param('routeCode') routeCode: string, @Param('stopId') stopId: string, @Body() dto: CompleteDeliveryDto) {
    return this.service.completeDelivery(routeCode, stopId, dto);
  }

  @Post('routes/:routeCode/stops/:stopId/fail')
  fail(@Param('routeCode') routeCode: string, @Param('stopId') stopId: string, @Body() dto: FailDeliveryDto) {
    return this.service.failDelivery(routeCode, stopId, dto);
  }

  @Post('routes/:routeCode/stops/:stopId/incidents')
  incident(@Param('routeCode') routeCode: string, @Param('stopId') stopId: string, @Body() dto: IncidentDto) {
    return this.service.reportIncident(routeCode, stopId, dto);
  }
}
