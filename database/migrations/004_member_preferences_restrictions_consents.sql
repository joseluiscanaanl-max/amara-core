CREATE TABLE IF NOT EXISTS household.preferences (
  id UUID PRIMARY KEY,
  preference_code VARCHAR(24) NOT NULL UNIQUE,
  household_id UUID NOT NULL REFERENCES household.households(id),
  member_id UUID NOT NULL REFERENCES household.members(id),
  category_code VARCHAR(50) NOT NULL,
  value_code VARCHAR(100),
  value_text TEXT,
  source_code VARCHAR(30) NOT NULL DEFAULT 'DECLARED',
  confidence_score NUMERIC(5,2),
  status_code VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS household.consents (
  id UUID PRIMARY KEY,
  consent_code VARCHAR(24) NOT NULL UNIQUE,
  household_id UUID NOT NULL REFERENCES household.households(id),
  member_id UUID REFERENCES household.members(id),
  consent_type_code VARCHAR(60) NOT NULL,
  notice_version VARCHAR(60) NOT NULL,
  accepted BOOLEAN NOT NULL,
  channel_code VARCHAR(40) NOT NULL DEFAULT 'WEB_MOBILE',
  evidence JSONB,
  granted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  status_code VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS household.restrictions (
  id UUID PRIMARY KEY,
  restriction_code VARCHAR(24) NOT NULL UNIQUE,
  household_id UUID NOT NULL REFERENCES household.households(id),
  member_id UUID NOT NULL REFERENCES household.members(id),
  consent_id UUID NOT NULL REFERENCES household.consents(id),
  restriction_type_code VARCHAR(50) NOT NULL,
  subject VARCHAR(150) NOT NULL,
  description TEXT,
  declared_severity_code VARCHAR(30),
  cross_contamination_risk BOOLEAN NOT NULL DEFAULT FALSE,
  source_code VARCHAR(40) NOT NULL DEFAULT 'DECLARED',
  review_status_code VARCHAR(30) NOT NULL DEFAULT 'REVIEW_REQUIRED',
  operational_alert BOOLEAN NOT NULL DEFAULT FALSE,
  status_code VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  archive_reason TEXT
);

CREATE INDEX IF NOT EXISTS ix_preferences_member_active ON household.preferences(member_id, is_active);
CREATE INDEX IF NOT EXISTS ix_restrictions_member_active ON household.restrictions(member_id, is_active);
CREATE INDEX IF NOT EXISTS ix_restrictions_operational_alert ON household.restrictions(operational_alert) WHERE operational_alert=TRUE;
CREATE INDEX IF NOT EXISTS ix_consents_member_type ON household.consents(member_id, consent_type_code);

INSERT INTO core.business_sequences(sequence_code,prefix,current_value,padding) VALUES
('PREFERENCE','PRE-',0,8),('RESTRICTION','RES-',0,8),('CONSENT','CON-',0,8)
ON CONFLICT (sequence_code) DO NOTHING;
