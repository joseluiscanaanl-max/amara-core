import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { MemberCareService } from './member-care.service';

class CreatePreferenceDto {
  @IsString() categoryCode!: string;
  @IsOptional() @IsString() valueCode?: string;
  @IsOptional() @IsString() valueText?: string;
}
class CreateRestrictionDto {
  @IsString() typeCode!: string;
  @IsString() @Length(2,150) subject!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() declaredSeverityCode?: string;
  @IsOptional() @IsBoolean() crossContaminationRisk?: boolean;
  @IsBoolean() consentAccepted!: boolean;
  @IsString() noticeVersion!: string;
}

@Controller('households/:haid/members/:memberCode')
export class MemberCareController {
  constructor(private readonly service: MemberCareService) {}
  @Get('care-profile') getProfile(@Param('haid') haid: string, @Param('memberCode') memberCode: string) { return this.service.getProfile(haid, memberCode); }
  @Post('preferences') addPreference(@Param('haid') haid: string, @Param('memberCode') memberCode: string, @Body() input: CreatePreferenceDto) { return this.service.addPreference(haid, memberCode, input); }
  @Post('restrictions') addRestriction(@Param('haid') haid: string, @Param('memberCode') memberCode: string, @Body() input: CreateRestrictionDto) { return this.service.addRestriction(haid, memberCode, input); }
}
