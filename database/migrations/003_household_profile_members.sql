ALTER TABLE household.households
  ADD COLUMN IF NOT EXISTS household_type_code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS estimated_members SMALLINT,
  ADD COLUMN IF NOT EXISTS origin_channel_code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS referral_code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

ALTER TABLE household.households
  DROP CONSTRAINT IF EXISTS ck_household_estimated_members;
ALTER TABLE household.households
  ADD CONSTRAINT ck_household_estimated_members
  CHECK (estimated_members IS NULL OR estimated_members BETWEEN 1 AND 20);

ALTER TABLE household.members
  ADD COLUMN IF NOT EXISTS age_range_code VARCHAR(30),
  ADD COLUMN IF NOT EXISTS household_role_code VARCHAR(40),
  ADD COLUMN IF NOT EXISTS is_account_manager BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_authorize_dependents BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS requires_representative BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS representative_member_id UUID REFERENCES household.members(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ix_members_household_active
ON household.members(household_id, is_active);

CREATE INDEX IF NOT EXISTS ix_households_status_active
ON household.households(status_code, is_active);

INSERT INTO core.business_sequences(sequence_code,prefix,current_value,padding)
VALUES ('MEMBER','INT-',0,8)
ON CONFLICT (sequence_code) DO NOTHING;
