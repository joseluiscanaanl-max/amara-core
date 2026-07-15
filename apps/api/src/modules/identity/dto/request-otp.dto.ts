import { IsString, Matches } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'El telÃ©fono debe estar en formato internacional E.164.',
  })
  phone!: string;
}