import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { HouseholdsService } from './households.service';

class UpdateHouseholdProfileDto {
  @IsString()
  @Length(2, 100)
  householdName!: string;

  @IsOptional()
  @IsString()
  householdTypeCode?: string;

  @IsInt()
  @Min(1)
  @Max(20)
  estimatedMembers!: number;

  @IsOptional()
  @IsString()
  originChannelCode?: string;

  @IsOptional()
  @IsString()
  referralCode?: string;
}

class CreateMemberDto {
  @IsString()
  @Length(2, 100)
  firstName!: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  alias?: string;

  @IsOptional()
  @IsString()
  ageRangeCode?: string;

  @IsOptional()
  @IsString()
  householdRoleCode?: string;

  @IsOptional()
  @IsBoolean()
  isPrimaryResponsible?: boolean;

  @IsOptional()
  @IsBoolean()
  isAccountManager?: boolean;

  @IsOptional()
  @IsBoolean()
  canAuthorizeDependents?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresRepresentative?: boolean;

  @IsOptional()
  @IsString()
  representativeMemberCode?: string;
}

@Controller('households')
export class HouseholdsController {
  constructor(private readonly householdsService: HouseholdsService) {}

  @Get(':haid')
  getHousehold(@Param('haid') haid: string): Promise<object> {
    return this.householdsService.getByHaid(haid);
  }

  @Patch(':haid/profile')
  updateProfile(@Param('haid') haid: string, @Body() input: UpdateHouseholdProfileDto): Promise<object> {
    return this.householdsService.updateProfile(haid, input);
  }

  @Get(':haid/members')
  listMembers(@Param('haid') haid: string): Promise<object> {
    return this.householdsService.listMembers(haid);
  }

  @Post(':haid/members')
  createMember(@Param('haid') haid: string, @Body() input: CreateMemberDto): Promise<object> {
    return this.householdsService.createMember(haid, input);
  }
}
