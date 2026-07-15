export type OtpPurpose = 'REGISTRATION' | 'LOGIN' | 'RECOVERY';

export interface OtpChallengeProps {
  id: string;
  phone: string;
  purpose: OtpPurpose;
  secretHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  verifiedAt?: Date;
  createdAt: Date;
}

export class OtpChallenge {
  private constructor(private readonly props: OtpChallengeProps) {}

  static create(props: OtpChallengeProps): OtpChallenge {
    return new OtpChallenge(props);
  }

  isExpired(now = new Date()): boolean {
    return now >= this.props.expiresAt;
  }

  isVerified(): boolean {
    return Boolean(this.props.verifiedAt);
  }
}