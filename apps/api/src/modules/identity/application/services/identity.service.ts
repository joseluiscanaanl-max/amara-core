import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { RequestOtpDto } from '../../dto/request-otp.dto';
import { VerifyOtpDto } from '../../dto/verify-otp.dto';
import {
  OTP_CHALLENGE_REPOSITORY,
} from '../../domain/repositories/otp-challenge.repository';

import type {
  OtpChallengeRepository,
} from '../../domain/repositories/otp-challenge.repository';

@Injectable()
export class IdentityService {
  private readonly expiresInSeconds = 300;
  private readonly maxAttempts = 5;
  private readonly pepper: string;
  private readonly developmentEcho: boolean;

  constructor(
    @Inject(OTP_CHALLENGE_REPOSITORY)
    private readonly otpRepository: OtpChallengeRepository,
    configService: ConfigService,
  ) {
    this.pepper = configService.get<string>('OTP_PEPPER') ?? 'development-only-change-me';
    this.developmentEcho = configService.get<string>('OTP_DEVELOPMENT_ECHO') === 'true';
  }

  async requestOtp(dto: RequestOtpDto) {
    const challengeId = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + this.expiresInSeconds * 1000);

    await this.otpRepository.invalidateActive(dto.phone, dto.purpose);
    await this.otpRepository.create({
      id: challengeId,
      phone: dto.phone,
      purpose: dto.purpose,
      secretHash: this.hashCode(challengeId, code),
      maxAttempts: this.maxAttempts,
      expiresAt,
    });

    return {
      success: true,
      data: {
        challengeId,
        phone: dto.phone,
        purpose: dto.purpose,
        expiresInSeconds: this.expiresInSeconds,
        ...(this.developmentEcho ? { developmentCode: code } : {}),
      },
    };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const challenge = await this.otpRepository.findByIdForUpdate(dto.challengeId);

    if (!challenge) {
      throw new BadRequestException('El desafío OTP no existe o fue invalidado.');
    }
    if (challenge.verifiedAt) {
      throw new BadRequestException('El código OTP ya fue utilizado.');
    }
    if (challenge.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('El código OTP expiró.');
    }
    if (challenge.attempts >= challenge.maxAttempts) {
  throw new HttpException(
    'Se alcanzó el número máximo de intentos.',
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

    const expected = Buffer.from(challenge.secretHash, 'hex');
    const received = Buffer.from(this.hashCode(challenge.id, dto.code), 'hex');
    const valid = expected.length === received.length && timingSafeEqual(expected, received);

    if (!valid) {
      const attempts = await this.otpRepository.incrementAttempts(challenge.id);
      throw new UnauthorizedException({
        message: 'El código OTP es incorrecto.',
        remainingAttempts: Math.max(challenge.maxAttempts - attempts, 0),
      });
    }

    const verifiedAt = new Date();
    await this.otpRepository.markVerified(challenge.id, verifiedAt);

    return {
      success: true,
      data: {
        challengeId: challenge.id,
        phone: challenge.phone,
        purpose: challenge.purpose,
        verifiedAt: verifiedAt.toISOString(),
        status: 'OTP_VERIFIED',
      },
    };
  }

  private hashCode(challengeId: string, code: string): string {
    return createHmac('sha256', this.pepper)
      .update(`${challengeId}:${code}`)
      .digest('hex');
  }
}