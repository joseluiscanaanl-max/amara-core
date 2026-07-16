export type OtpPurpose = 'REGISTRATION' | 'LOGIN' | 'RECOVERY';

export interface StoredOtpChallenge {
  id: string;
  phone: string;
  purpose: OtpPurpose;
  secretHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  verifiedAt: Date | null;
  createdAt: Date;
}

export interface CreateOtpChallengeInput {
  id: string;
  phone: string;
  purpose: OtpPurpose;
  secretHash: string;
  maxAttempts: number;
  expiresAt: Date;
}

export const OTP_CHALLENGE_REPOSITORY = Symbol('OTP_CHALLENGE_REPOSITORY');

export interface OtpChallengeRepository {
  invalidateActive(phone: string, purpose: OtpPurpose): Promise<void>;
  create(input: CreateOtpChallengeInput): Promise<void>;
  findByIdForUpdate(id: string): Promise<StoredOtpChallenge | null>;
  incrementAttempts(id: string): Promise<number>;
  markVerified(id: string, verifiedAt: Date): Promise<void>;
}