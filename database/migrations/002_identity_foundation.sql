CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE IF NOT EXISTS identity.users (
    id UUID PRIMARY KEY,
    phone_e164 VARCHAR(20) NOT NULL UNIQUE,
    status_code VARCHAR(30) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS identity.otp_challenges (
    id UUID PRIMARY KEY,
    phone_e164 VARCHAR(20) NOT NULL,
    purpose_code VARCHAR(30) NOT NULL,
    secret_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    expires_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_identity_otp_attempts
        CHECK (attempts >= 0 AND max_attempts > 0 AND attempts <= max_attempts)
);

CREATE INDEX IF NOT EXISTS ix_identity_otp_phone_created
ON identity.otp_challenges (phone_e164, created_at DESC);