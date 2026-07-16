import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CreatedHousehold } from '../../domain/interfaces/household.interface';
import {
  HOUSEHOLD_REPOSITORY,
} from '../../domain/repositories/household.repository';
import type {
  HouseholdRepository,
} from '../../domain/repositories/household.repository';
import type { CreateHouseholdDto } from '../../dto/create-household.dto';

@Injectable()
export class HouseholdsService {
  constructor(
    @Inject(HOUSEHOLD_REPOSITORY)
    private readonly householdRepository: HouseholdRepository,
  ) {}

  async create(
    dto: CreateHouseholdDto,
  ): Promise<CreatedHousehold> {
    return this.householdRepository.create({
      id: randomUUID(),
      membershipId: randomUUID(),
      name: dto.name.trim(),
      createdByUserId: dto.createdByUserId,
    });
  }

  async findById(id: string) {
    return this.householdRepository.findById(id);
  }
}