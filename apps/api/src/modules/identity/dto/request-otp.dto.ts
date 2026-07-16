import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'El teléfono debe estar en formato internacional E.164.',
  })
  phone!: string;

  @IsOptional()
  @IsIn(['REGISTRATION', 'LOGIN', 'RECOVERY'])
  purpose: 'REGISTRATION' | 'LOGIN' | 'RECOVERY' = 'REGISTRATION';
}