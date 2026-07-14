CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS household;
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS core.business_sequences (
  sequence_code VARCHAR(50) PRIMARY KEY,
  prefix VARCHAR(20) NOT NULL,
  current_value BIGINT NOT NULL DEFAULT 0,
  padding SMALLINT NOT NULL DEFAULT 8,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO core.business_sequences(sequence_code,prefix,current_value,padding)
VALUES ('HOUSEHOLD','HA-',0,8),('MEMBER','INT-',0,8),('AUDIT','AUD-',0,8)
ON CONFLICT (sequence_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS household.households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  haid VARCHAR(20) NOT NULL UNIQUE,
  household_name VARCHAR(100),
  status_code VARCHAR(40) NOT NULL DEFAULT 'VERIFIED',
  is_founder_household BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS identity.digital_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES household.households(id),
  identity_type_code VARCHAR(40) NOT NULL DEFAULT 'PHONE',
  status_code VARCHAR(30) NOT NULL DEFAULT 'VERIFIED',
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  verified_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS identity.phones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  digital_identity_id UUID NOT NULL REFERENCES identity.digital_identities(id),
  country_code CHAR(2) NOT NULL,
  phone_e164 VARCHAR(20) NOT NULL,
  masked_phone VARCHAR(20) NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  verified_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_phones_e164_active
ON identity.phones(phone_e164) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS identity.otp_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID,
  phone_e164 VARCHAR(20) NOT NULL,
  secret_hash TEXT NOT NULL,
  purpose_code VARCHAR(40) NOT NULL,
  status_code VARCHAR(30) NOT NULL DEFAULT 'CREATED',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS household.members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_code VARCHAR(20) NOT NULL UNIQUE,
  household_id UUID NOT NULL REFERENCES household.households(id),
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100),
  alias VARCHAR(100),
  is_primary_responsible BOOLEAN NOT NULL DEFAULT FALSE,
  status_code VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_members_primary_responsible
ON household.members(household_id)
WHERE is_primary_responsible = TRUE AND is_active = TRUE;

CREATE TABLE IF NOT EXISTS audit.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_code VARCHAR(30) NOT NULL UNIQUE,
  actor_type VARCHAR(30) NOT NULL,
  actor_id UUID,
  action_code VARCHAR(120) NOT NULL,
  entity_type VARCHAR(80),
  entity_id UUID,
  previous_value JSONB,
  new_value JSONB,
  result_code VARCHAR(30) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
