import { Injectable } from '@nestjs/common';
import { RequestOtpDto } from '../../dto/request-otp.dto';
import { VerifyOtpDto } from '../../dto/verify-otp.dto';

@Injectable()
export class IdentityService {
  requestOtp(dto: RequestOtpDto) {
    return {
      success: true,
      data: {
        phone: dto.phone,
        status: 'OTP_REQUEST_ACCEPTED',
      },
    };
  }

  verifyOtp(dto: VerifyOtpDto) {
    return {
      success: true,
      data: {
        phone: dto.phone,
        status: 'OTP_VERIFICATION_PENDING_IMPLEMENTATION',
      },
    };
  }
}