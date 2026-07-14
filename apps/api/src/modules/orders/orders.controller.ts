import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrdersService } from './orders.service';

class CreateOrderItemDto {
  @IsString()
  dishCode!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

class CreateScheduledOrderDto {
  @IsUUID()
  clientRequestId!: string;

  @IsString()
  haid!: string;

  @IsString()
  locationCode!: string;

  @IsDateString()
  serviceDate!: string;

  @IsDateString()
  deliveryWindowStart!: string;

  @IsDateString()
  deliveryWindowEnd!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @Post('scheduled')
  create(@Body() dto: CreateScheduledOrderDto) {
    return this.service.createScheduled(dto);
  }

  @Get('households/:haid')
  listForHousehold(@Param('haid') haid: string) {
    return this.service.listForHousehold(haid);
  }

  @Get(':orderCode')
  get(@Param('orderCode') orderCode: string) {
    return this.service.get(orderCode);
  }
}
