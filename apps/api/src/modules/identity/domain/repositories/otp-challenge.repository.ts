import { OtpChallenge } from '../entities/otp-challenge.entity';

export const OTP_CHALLENGE_REPOSITORY = Symbol('OTP_CHALLENGE_REPOSITORY');

export interface OtpChallengeRepository {
  findLatestActiveByPhone(phone: string): Promise<OtpChallenge | null>;
  save(challenge: OtpChallenge): Promise<void>;
}