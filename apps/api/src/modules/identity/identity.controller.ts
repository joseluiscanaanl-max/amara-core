import { Body, Controller, Post } from '@nestjs/common';
import { IsBoolean, IsString, Length } from 'class-validator';
import { IdentityService } from './identity.service';

class StartRegistrationDto {
  @IsString()
  countryCode!: string;

  @IsString()
  @Length(10, 15)
  phone!: string;

  @IsBoolean()
  privacyConsent!: boolean;
}

class VerifyOtpDto {
  @IsString()
  registrationId!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}

@Controller('households/registration')
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Post('start')
  async start(@Body() input: StartRegistrationDto): Promise<object> {
    return this.identityService.startRegistration(input);
  }

  @Post('verify-otp')
  async verify(@Body() input: VerifyOtpDto): Promise<object> {
    return this.identityService.verifyOtp(input);
  }
}
