import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, IsPostalCode, IsString, Length, Max, Min } from 'class-validator';
import { TerritoryService } from './territory.service';
class CreateLocationDto {
 @IsString() @Length(2,80) alias!: string;
 @IsString() @Length(2,150) street!: string;
 @IsString() @Length(1,30) exteriorNumber!: string;
 @IsOptional() @IsString() interiorNumber?: string;
 @IsString() @Length(2,150) colonyName!: string;
 @IsPostalCode('MX') postalCode!: string;
 @IsString() city!: string;
 @IsString() stateName!: string;
 @IsOptional() @IsString() betweenStreets?: string;
 @IsOptional() @IsString() references?: string;
 @IsNumber() @Min(-90) @Max(90) latitude!: number;
 @IsNumber() @Min(-180) @Max(180) longitude!: number;
 @IsOptional() @IsNumber() accessLatitude?: number;
 @IsOptional() @IsNumber() accessLongitude?: number;
 @IsOptional() @IsBoolean() isPrimary?: boolean;
}
@Controller('households/:haid/locations')
export class TerritoryController {
 constructor(private readonly service: TerritoryService) {}
 @Get() list(@Param('haid') haid:string){ return this.service.list(haid); }
 @Post() create(@Param('haid') haid:string,@Body() dto:CreateLocationDto){ return this.service.create(haid,dto); }
 @Get(':locationCode/coverage') coverage(@Param('haid') haid:string,@Param('locationCode') locationCode:string){ return this.service.getCoverage(haid,locationCode); }
}
