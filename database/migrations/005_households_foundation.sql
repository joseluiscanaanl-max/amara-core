CREATE SCHEMA IF NOT EXISTS household;

CREATE TABLE IF NOT EXISTS household.households (
    id UUID PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    created_by_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_households_created_by
        FOREIGN KEY (created_by_user_id)
        REFERENCES identity.users(id)
        ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS household.members (
    id UUID PRIMARY KEY,
    household_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role_code VARCHAR(40) NOT NULL DEFAULT 'MEMBER',
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_household_members_household
        FOREIGN KEY (household_id)
        REFERENCES household.households(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_household_members_user
        FOREIGN KEY (user_id)
        REFERENCES identity.users(id)
        ON DELETE CASCADE,

    CONSTRAINT uq_household_member
        UNIQUE (household_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_households_created_by
ON household.households(created_by_user_id);

CREATE INDEX IF NOT EXISTS idx_household_members_user
ON household.members(user_id);

CREATE INDEX IF NOT EXISTS idx_household_members_household
ON household.members(household_id);