CREATE TABLE IF NOT EXISTS identity.household_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_code VARCHAR(30) NOT NULL UNIQUE,
  country_code CHAR(2) NOT NULL,
  phone_e164 VARCHAR(20) NOT NULL,
  masked_phone VARCHAR(20) NOT NULL,
  privacy_consent_at TIMESTAMPTZ NOT NULL,
  status_code VARCHAR(30) NOT NULL DEFAULT 'PENDING_OTP',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);

ALTER TABLE identity.otp_verifications
  ADD COLUMN IF NOT EXISTS otp_code VARCHAR(30),
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5;

CREATE UNIQUE INDEX IF NOT EXISTS ux_otp_code
ON identity.otp_verifications(otp_code)
WHERE otp_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_registration_phone_status
ON identity.household_registrations(phone_e164, status_code);

CREATE TABLE IF NOT EXISTS core.domain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_code VARCHAR(30) NOT NULL UNIQUE,
  event_type VARCHAR(120) NOT NULL,
  aggregate_type VARCHAR(80) NOT NULL,
  aggregate_id UUID NOT NULL,
  aggregate_business_code VARCHAR(50),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status_code VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);
