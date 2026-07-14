CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS household;

CREATE TABLE IF NOT EXISTS core.system_metadata (
    id BIGSERIAL PRIMARY KEY,
    system_name VARCHAR(100) NOT NULL,
    version VARCHAR(30) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO core.system_metadata (system_name, version)
SELECT 'AMARA CORE', '0.1.0'
WHERE NOT EXISTS (
    SELECT 1 FROM core.system_metadata WHERE system_name = 'AMARA CORE'
);