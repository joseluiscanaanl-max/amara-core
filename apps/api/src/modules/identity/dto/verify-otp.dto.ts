import { IsString, IsUUID, Length, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsUUID()
  challengeId!: string;

  @IsString()
  @Length(6, 6, {
    message: 'El código debe contener exactamente 6 dígitos.',
  })
  @Matches(/^\d{6}$/, {
    message: 'El código debe contener únicamente números.',
  })
  code!: string;
}