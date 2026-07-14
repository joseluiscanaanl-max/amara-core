import { Body, Controller, Get, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, Param, Patch, Post, Query } from '@nestjs/common';
import { ExperienceService } from './experience.service';

class EvaluationDto {
  @IsString() @MaxLength(24) haid!: string;
  @IsInt() @Min(1) @Max(5) easeScore!: number;
  @IsInt() @Min(1) @Max(5) punctualityScore!: number;
  @IsInt() @Min(1) @Max(5) qualityScore!: number;
  @IsInt() @Min(1) @Max(5) tranquilityScore!: number;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
  @IsOptional() @IsBoolean() reportProblem?: boolean;
  @IsOptional() @IsString() @MaxLength(60) problemCategoryCode?: string;
}

class CreateIncidentDto {
  @IsString() @MaxLength(24) haid!: string;
  @IsOptional() @IsString() @MaxLength(24) orderCode?: string;
  @IsString() @MaxLength(60) categoryCode!: string;
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) severity!: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  @IsString() @MaxLength(2500) description!: string;
  @IsOptional() @IsString() @MaxLength(80) assignedUserCode?: string;
  @IsOptional() @IsString() dueAt?: string;
}

class AssignIncidentDto {
  @IsString() @MaxLength(80) assignedUserCode!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

class UpdateIncidentDto {
  @IsString() @MaxLength(2000) note!: string;
  @IsOptional() @IsIn(['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'WAITING_HOUSEHOLD', 'RESOLVED', 'CLOSED'])
  status?: 'OPEN' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'WAITING_HOUSEHOLD' | 'RESOLVED' | 'CLOSED';
  @IsOptional() @IsString() @MaxLength(80) userCode?: string;
}

class ResolveIncidentDto {
  @IsString() @MaxLength(2500) resolutionSummary!: string;
  @IsOptional() @IsString() @MaxLength(60) rootCauseCode?: string;
  @IsOptional() @IsString() @MaxLength(80) userCode?: string;
}

class CompensationDto {
  @IsString() @MaxLength(50) compensationTypeCode!: string;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsString() @MaxLength(1000) description!: string;
  @IsOptional() @IsString() @MaxLength(80) proposedByUserCode?: string;
}

class ApproveCompensationDto {
  @IsString() @MaxLength(80) approvedByUserCode!: string;
}

@Controller('experience')
export class ExperienceController {
  constructor(private readonly service: ExperienceService) {}

  @Post('orders/:orderCode/evaluations')
  evaluate(@Param('orderCode') orderCode: string, @Body() dto: EvaluationDto) {
    return this.service.createEvaluation(orderCode, dto);
  }

  @Get('households/:haid/evaluations')
  householdEvaluations(@Param('haid') haid: string) { return this.service.listHouseholdEvaluations(haid); }

  @Post('incidents')
  createIncident(@Body() dto: CreateIncidentDto) { return this.service.createIncident(dto); }

  @Get('incidents')
  listIncidents(@Query('status') status?: string, @Query('severity') severity?: string, @Query('cppCode') cppCode?: string,
    @Query('assignedUserCode') assignedUserCode?: string, @Query('haid') haid?: string) {
    return this.service.listIncidents({ status, severity, cppCode, assignedUserCode, haid });
  }

  @Get('incidents/:incidentCode')
  getIncident(@Param('incidentCode') incidentCode: string) { return this.service.getIncident(incidentCode); }

  @Post('incidents/:incidentCode/assign')
  assign(@Param('incidentCode') incidentCode: string, @Body() dto: AssignIncidentDto) { return this.service.assignIncident(incidentCode, dto); }

  @Post('incidents/:incidentCode/updates')
  update(@Param('incidentCode') incidentCode: string, @Body() dto: UpdateIncidentDto) { return this.service.addUpdate(incidentCode, dto); }

  @Post('incidents/:incidentCode/resolve')
  resolve(@Param('incidentCode') incidentCode: string, @Body() dto: ResolveIncidentDto) { return this.service.resolveIncident(incidentCode, dto); }

  @Post('incidents/:incidentCode/close')
  close(@Param('incidentCode') incidentCode: string, @Body() dto: UpdateIncidentDto) { return this.service.closeIncident(incidentCode, dto); }

  @Post('incidents/:incidentCode/compensations')
  proposeCompensation(@Param('incidentCode') incidentCode: string, @Body() dto: CompensationDto) {
    return this.service.proposeCompensation(incidentCode, dto);
  }

  @Post('compensations/:compensationCode/approve')
  approveCompensation(@Param('compensationCode') compensationCode: string, @Body() dto: ApproveCompensationDto) {
    return this.service.approveCompensation(compensationCode, dto);
  }
}
