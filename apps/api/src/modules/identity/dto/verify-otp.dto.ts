import { IsString, Length, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'El telÃ©fono debe estar en formato internacional E.164.',
  })
  phone!: string;

  @IsString()
  @Length(6, 6, {
    message: 'El cÃ³digo debe contener exactamente 6 dÃ­gitos.',
  })
  @Matches(/^\d{6}$/, {
    message: 'El cÃ³digo debe contener Ãºnicamente nÃºmeros.',
  })
  code!: string;
}