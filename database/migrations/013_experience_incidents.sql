BEGIN;

CREATE SCHEMA IF NOT EXISTS experience;

INSERT INTO core.business_sequences(sequence_code,prefix,current_value,padding,updated_at)
VALUES
  ('EXPERIENCE_EVALUATION','EXP-',0,10,NOW()),
  ('SERVICE_INCIDENT','INC-',0,10,NOW()),
  ('INCIDENT_UPDATE','SEG-',0,10,NOW()),
  ('COMPENSATION','COM-',0,10,NOW())
ON CONFLICT (sequence_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS experience.evaluations (
  id UUID PRIMARY KEY,
  evaluation_code VARCHAR(24) NOT NULL UNIQUE,
  order_id UUID NOT NULL UNIQUE REFERENCES commerce.orders(id),
  delivery_id UUID REFERENCES logistics.deliveries(id),
  household_id UUID NOT NULL REFERENCES household.households(id),
  ease_score SMALLINT NOT NULL,
  punctuality_score SMALLINT NOT NULL,
  quality_score SMALLINT NOT NULL,
  tranquility_score SMALLINT NOT NULL,
  comment TEXT,
  channel_code VARCHAR(30) NOT NULL DEFAULT 'HOUSEHOLD_WEB',
  requires_follow_up BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_experience_scores CHECK (
    ease_score BETWEEN 1 AND 5 AND
    punctuality_score BETWEEN 1 AND 5 AND
    quality_score BETWEEN 1 AND 5 AND
    tranquility_score BETWEEN 1 AND 5
  )
);

CREATE TABLE IF NOT EXISTS experience.incidents (
  id UUID PRIMARY KEY,
  incident_code VARCHAR(24) NOT NULL UNIQUE,
  household_id UUID NOT NULL REFERENCES household.households(id),
  order_id UUID REFERENCES commerce.orders(id),
  delivery_id UUID REFERENCES logistics.deliveries(id),
  cpp_id UUID REFERENCES operations.cpp(id),
  evaluation_id UUID REFERENCES experience.evaluations(id),
  category_code VARCHAR(60) NOT NULL,
  severity_code VARCHAR(30) NOT NULL DEFAULT 'MEDIUM',
  source_code VARCHAR(30) NOT NULL,
  description TEXT NOT NULL,
  status_code VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  assigned_user_id UUID REFERENCES core.internal_users(id),
  due_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  resolution_summary TEXT,
  root_cause_code VARCHAR(60),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS experience.incident_updates (
  id UUID PRIMARY KEY,
  update_code VARCHAR(24) NOT NULL UNIQUE,
  incident_id UUID NOT NULL REFERENCES experience.incidents(id),
  update_type_code VARCHAR(40) NOT NULL,
  note TEXT NOT NULL,
  status_before VARCHAR(30),
  status_after VARCHAR(30),
  created_by UUID REFERENCES core.internal_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS experience.compensations (
  id UUID PRIMARY KEY,
  compensation_code VARCHAR(24) NOT NULL UNIQUE,
  incident_id UUID NOT NULL REFERENCES experience.incidents(id),
  compensation_type_code VARCHAR(50) NOT NULL,
  amount NUMERIC(12,2),
  currency_code CHAR(3) NOT NULL DEFAULT 'MXN',
  description TEXT NOT NULL,
  status_code VARCHAR(30) NOT NULL DEFAULT 'PROPOSED',
  proposed_by UUID REFERENCES core.internal_users(id),
  approved_by UUID REFERENCES core.internal_users(id),
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  CONSTRAINT ck_compensation_amount CHECK (amount IS NULL OR amount >= 0)
);

CREATE INDEX IF NOT EXISTS ix_experience_evaluations_household
ON experience.evaluations(household_id,submitted_at DESC);
CREATE INDEX IF NOT EXISTS ix_experience_incidents_status
ON experience.incidents(status_code,severity_code,opened_at);
CREATE INDEX IF NOT EXISTS ix_experience_incidents_household
ON experience.incidents(household_id,opened_at DESC);
CREATE INDEX IF NOT EXISTS ix_experience_incidents_assigned
ON experience.incidents(assigned_user_id,status_code);
CREATE INDEX IF NOT EXISTS ix_incident_updates_incident
ON experience.incident_updates(incident_id,created_at);
CREATE INDEX IF NOT EXISTS ix_compensations_incident
ON experience.compensations(incident_id,status_code);

COMMIT;
