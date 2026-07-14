import {
  BadRequestException,
  ConflictException,
  Injectable,
  TooManyRequestsException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { DatabaseService } from '../../common/database.service';

type StartInput = { countryCode: string; phone: string; privacyConsent: boolean };
type VerifyInput = { registrationId: string; code: string };

type RegistrationRow = {
  id: string;
  registration_code: string;
  phone_e164: string;
  masked_phone: string;
  status_code: string;
  expires_at: Date;
};

type OtpRow = {
  id: string;
  secret_hash: string;
  attempt_count: number;
  max_attempts: number;
  status_code: string;
  expires_at: Date;
  verified_at: Date | null;
};

@Injectable()
export class IdentityService {
  private readonly expirationMinutes: number;
  private readonly maxAttempts: number;
  private readonly pepper: string;

  constructor(
    private readonly db: DatabaseService,
    config: ConfigService,
  ) {
    this.expirationMinutes = Number(config.get('OTP_EXPIRATION_MINUTES') ?? 5);
    this.maxAttempts = Number(config.get('OTP_MAX_ATTEMPTS') ?? 5);
    this.pepper = config.get<string>('OTP_SECRET_PEPPER') ?? 'development-only-pepper';
  }

  async startRegistration(input: StartInput): Promise<object> {
    if (!input.privacyConsent) throw new BadRequestException('CONSENT_REQUIRED');

    const phoneE164 = this.normalizePhone(input.countryCode, input.phone);
    const digits = phoneE164.replace(/\D/g, '');
    const maskedPhone = `******${digits.slice(-4)}`;

    const duplicate = await this.db.query(
      `SELECT 1 FROM identity.phones WHERE phone_e164 = $1 AND is_active = TRUE LIMIT 1`,
      [phoneE164],
    );
    if (duplicate.rowCount) throw new ConflictException('PHONE_ALREADY_REGISTERED');

    const otp = String(randomInt(100000, 1000000));
    const registrationId = randomUUID();
    const registrationCode = `REG-${registrationId.slice(0, 8).toUpperCase()}`;
    const otpCode = `OTP-${randomUUID().slice(0, 8).toUpperCase()}`;
    const expiresAt = new Date(Date.now() + this.expirationMinutes * 60_000);
    const secretHash = this.hashOtp(registrationId, otp);

    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO identity.household_registrations
         (id, registration_code, country_code, phone_e164, masked_phone, privacy_consent_at, status_code, expires_at)
         VALUES ($1,$2,$3,$4,$5,NOW(),'PENDING_OTP',$6)`,
        [registrationId, registrationCode, input.countryCode.toUpperCase(), phoneE164, maskedPhone, expiresAt],
      );
      await client.query(
        `INSERT INTO identity.otp_verifications
         (registration_id, otp_code, phone_e164, secret_hash, purpose_code, status_code, max_attempts, expires_at)
         VALUES ($1,$2,$3,$4,'REGISTRATION','SENT',$5,$6)`,
        [registrationId, otpCode, phoneE164, secretHash, this.maxAttempts, expiresAt],
      );
      await client.query(
        `INSERT INTO audit.audit_events
         (audit_code, actor_type, action_code, entity_type, entity_id, new_value, result_code)
         VALUES ($1,'PUBLIC','HOUSEHOLD_REGISTRATION_STARTED','REGISTRATION',$2,$3,'SUCCESS')`,
        [`AUD-${randomUUID().slice(0, 8).toUpperCase()}`, registrationId, JSON.stringify({ maskedPhone })],
      );
    });

    return {
      success: true,
      data: {
        registrationId,
        maskedPhone,
        otpStatus: 'SENT',
        expiresIn: this.expirationMinutes * 60,
        resendAvailableIn: 60,
        developmentCode: process.env.NODE_ENV === 'production' ? undefined : otp,
      },
      meta: { timestamp: new Date().toISOString() },
    };
  }

  async verifyOtp(input: VerifyInput): Promise<object> {
    const precheck = await this.db.query<OtpRow & { registration_status: string; registration_expires_at: Date }>(
      `SELECT o.*, r.status_code AS registration_status, r.expires_at AS registration_expires_at
       FROM identity.otp_verifications o
       JOIN identity.household_registrations r ON r.id = o.registration_id
       WHERE r.id = $1 AND o.status_code IN ('SENT','BLOCKED')
       ORDER BY o.created_at DESC LIMIT 1`,
      [input.registrationId],
    );
    const currentOtp = precheck.rows[0];
    if (!currentOtp) throw new BadRequestException('REGISTRATION_NOT_FOUND');
    if (currentOtp.registration_status === 'COMPLETED') throw new BadRequestException('OTP_ALREADY_USED');
    if (new Date(currentOtp.registration_expires_at).getTime() < Date.now()) {
      throw new BadRequestException('OTP_EXPIRED');
    }
    if (currentOtp.status_code === 'BLOCKED' || currentOtp.attempt_count >= currentOtp.max_attempts) {
      throw new TooManyRequestsException('OTP_MAX_ATTEMPTS');
    }
    if (!this.compareOtp(input.registrationId, input.code, currentOtp.secret_hash)) {
      await this.db.query(
        `UPDATE identity.otp_verifications
         SET attempt_count = attempt_count + 1,
             status_code = CASE WHEN attempt_count + 1 >= max_attempts THEN 'BLOCKED' ELSE status_code END
         WHERE id = $1`,
        [currentOtp.id],
      );
      throw new BadRequestException('OTP_INVALID');
    }

    return this.db.transaction(async (client) => {
      const registrationResult = await client.query<RegistrationRow>(
        `SELECT * FROM identity.household_registrations WHERE id = $1 FOR UPDATE`,
        [input.registrationId],
      );
      const registration = registrationResult.rows[0];
      if (!registration) throw new BadRequestException('REGISTRATION_NOT_FOUND');
      if (registration.status_code === 'COMPLETED') throw new BadRequestException('OTP_ALREADY_USED');

      const otpResult = await client.query<OtpRow>(
        `SELECT * FROM identity.otp_verifications WHERE id = $1 FOR UPDATE`,
        [currentOtp.id],
      );
      const otp = otpResult.rows[0];
      if (!otp || otp.status_code !== 'SENT' || otp.verified_at) {
        throw new BadRequestException('OTP_ALREADY_USED');
      }

      const sequenceResult = await client.query<{ current_value: string; prefix: string; padding: number }>(
        `UPDATE core.business_sequences
         SET current_value = current_value + 1, updated_at = NOW()
         WHERE sequence_code = 'HOUSEHOLD'
         RETURNING current_value, prefix, padding`,
      );
      const sequence = sequenceResult.rows[0];
      if (!sequence) throw new Error('HOUSEHOLD sequence is missing');
      const haid = `${sequence.prefix}${String(sequence.current_value).padStart(sequence.padding, '0')}`;

      const householdResult = await client.query<{ id: string }>(
        `INSERT INTO household.households (haid, status_code, created_at, updated_at)
         VALUES ($1,'VERIFIED',NOW(),NOW()) RETURNING id`,
        [haid],
      );
      const householdId = householdResult.rows[0].id;

      const identityResult = await client.query<{ id: string }>(
        `INSERT INTO identity.digital_identities
         (household_id, identity_type_code, status_code, is_primary, verified_at)
         VALUES ($1,'PHONE','VERIFIED',TRUE,NOW()) RETURNING id`,
        [householdId],
      );

      await client.query(
        `INSERT INTO identity.phones
         (digital_identity_id, country_code, phone_e164, masked_phone, is_verified, is_primary, verified_at)
         VALUES ($1,$2,$3,$4,TRUE,TRUE,NOW())`,
        [identityResult.rows[0].id, registration.phone_e164.startsWith('+52') ? 'MX' : 'ZZ', registration.phone_e164, registration.masked_phone],
      );
      await client.query(
        `UPDATE identity.otp_verifications SET status_code='VERIFIED', verified_at=NOW() WHERE id=$1`,
        [otp.id],
      );
      await client.query(
        `UPDATE identity.household_registrations SET status_code='COMPLETED', completed_at=NOW() WHERE id=$1`,
        [registration.id],
      );
      await client.query(
        `INSERT INTO audit.audit_events
         (audit_code, actor_type, actor_id, action_code, entity_type, entity_id, new_value, result_code)
         VALUES ($1,'HOUSEHOLD',$2,'HOUSEHOLD_CREATED','HOUSEHOLD',$2,$3,'SUCCESS')`,
        [`AUD-${randomUUID().slice(0, 8).toUpperCase()}`, householdId, JSON.stringify({ haid })],
      );
      await client.query(
        `INSERT INTO core.domain_events
         (event_code,event_type,aggregate_type,aggregate_id,aggregate_business_code,payload,occurred_at)
         VALUES ($1,'household.phone_verified','HOUSEHOLD',$2,$3,$4,NOW())`,
        [`EVT-${randomUUID().slice(0, 8).toUpperCase()}`, householdId, haid, JSON.stringify({ haid, maskedPhone: registration.masked_phone })],
      );

      return {
        success: true,
        data: { haid, householdStatus: 'VERIFIED', nextStep: 'COMPLETE_HOUSEHOLD_PROFILE' },
        meta: { timestamp: new Date().toISOString() },
      };
    });
  }

  private normalizePhone(countryCode: string, rawPhone: string): string {
    const digits = rawPhone.replace(/\D/g, '');
    if (countryCode.toUpperCase() === 'MX') {
      if (digits.length !== 10) throw new BadRequestException('PHONE_INVALID');
      return `+52${digits}`;
    }
    if (digits.length < 8 || digits.length > 15) throw new BadRequestException('PHONE_INVALID');
    return `+${digits}`;
  }

  private hashOtp(registrationId: string, code: string): string {
    return createHmac('sha256', this.pepper).update(`${registrationId}:${code}`).digest('hex');
  }

  private compareOtp(registrationId: string, code: string, storedHash: string): boolean {
    const candidate = Buffer.from(this.hashOtp(registrationId, code), 'hex');
    const stored = Buffer.from(storedHash, 'hex');
    return candidate.length === stored.length && timingSafeEqual(candidate, stored);
  }
}
