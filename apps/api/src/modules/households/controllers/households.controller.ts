import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';

import { HouseholdsService } from '../application/services/households.service';
import { CreateHouseholdDto } from '../dto/create-household.dto';

@Controller('households')
export class HouseholdsController {
  constructor(
    private readonly householdsService: HouseholdsService,
  ) {}

  @Post()
  async create(
    @Body() dto: CreateHouseholdDto,
  ) {
    return this.householdsService.create(dto);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
  ) {
    return this.householdsService.findById(id);
  }
}