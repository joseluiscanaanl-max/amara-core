CREATE SCHEMA IF NOT EXISTS territory;
CREATE SCHEMA IF NOT EXISTS operations;

CREATE TABLE IF NOT EXISTS territory.markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_code VARCHAR(24) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  city VARCHAR(120) NOT NULL,
  municipality VARCHAR(120),
  state_name VARCHAR(120) NOT NULL,
  country_code CHAR(2) NOT NULL DEFAULT 'MX',
  timezone VARCHAR(60) NOT NULL DEFAULT 'America/Monterrey',
  status_code VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operations.cpp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cpp_code VARCHAR(24) NOT NULL UNIQUE,
  market_id UUID NOT NULL REFERENCES territory.markets(id),
  name VARCHAR(120) NOT NULL,
  status_code VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  street VARCHAR(150), exterior_number VARCHAR(30), neighborhood VARCHAR(120), postal_code VARCHAR(10),
  latitude NUMERIC(9,6), longitude NUMERIC(9,6),
  daily_capacity INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS territory.colonies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colony_code VARCHAR(24) NOT NULL UNIQUE,
  market_id UUID NOT NULL REFERENCES territory.markets(id),
  name VARCHAR(150) NOT NULL,
  postal_code VARCHAR(10),
  status_code VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  UNIQUE(market_id, name, postal_code)
);

CREATE TABLE IF NOT EXISTS territory.service_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_code VARCHAR(24) NOT NULL UNIQUE,
  market_id UUID NOT NULL REFERENCES territory.markets(id),
  primary_cpp_id UUID NOT NULL REFERENCES operations.cpp(id),
  name VARCHAR(120) NOT NULL,
  status_code VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  min_latitude NUMERIC(9,6), max_latitude NUMERIC(9,6),
  min_longitude NUMERIC(9,6), max_longitude NUMERIC(9,6),
  delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  minimum_order NUMERIC(10,2) NOT NULL DEFAULT 0,
  daily_capacity INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS territory.zone_colonies (
  zone_id UUID NOT NULL REFERENCES territory.service_zones(id),
  colony_id UUID NOT NULL REFERENCES territory.colonies(id),
  PRIMARY KEY(zone_id, colony_id)
);

CREATE TABLE IF NOT EXISTS household.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_code VARCHAR(24) NOT NULL UNIQUE,
  household_id UUID NOT NULL REFERENCES household.households(id),
  alias VARCHAR(80) NOT NULL,
  street VARCHAR(150) NOT NULL,
  exterior_number VARCHAR(30) NOT NULL,
  interior_number VARCHAR(30),
  colony_name VARCHAR(150) NOT NULL,
  postal_code VARCHAR(10) NOT NULL,
  city VARCHAR(120) NOT NULL,
  state_name VARCHAR(120) NOT NULL,
  between_streets TEXT,
  references_text TEXT,
  latitude NUMERIC(9,6) NOT NULL,
  longitude NUMERIC(9,6) NOT NULL,
  access_latitude NUMERIC(9,6),
  access_longitude NUMERIC(9,6),
  validation_level SMALLINT NOT NULL DEFAULT 1,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  status_code VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_household_primary_location ON household.locations(household_id) WHERE is_primary=TRUE AND is_active=TRUE;
CREATE INDEX IF NOT EXISTS ix_locations_household ON household.locations(household_id, is_active);
CREATE INDEX IF NOT EXISTS ix_locations_coordinates ON household.locations(latitude, longitude);

CREATE TABLE IF NOT EXISTS territory.location_coverage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coverage_code VARCHAR(24) NOT NULL UNIQUE,
  location_id UUID NOT NULL REFERENCES household.locations(id),
  market_id UUID REFERENCES territory.markets(id),
  colony_id UUID REFERENCES territory.colonies(id),
  zone_id UUID REFERENCES territory.service_zones(id),
  cpp_id UUID REFERENCES operations.cpp(id),
  is_covered BOOLEAN NOT NULL,
  coverage_method VARCHAR(30) NOT NULL,
  delivery_fee NUMERIC(10,2),
  minimum_order NUMERIC(10,2),
  reason_code VARCHAR(50),
  status_code VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ
);

INSERT INTO core.business_sequences(sequence_code,prefix,current_value,padding) VALUES
('LOCATION','LOC-',0,8),('COVERAGE','COV-',0,8)
ON CONFLICT (sequence_code) DO NOTHING;

WITH m AS (
  INSERT INTO territory.markets(market_code,name,city,municipality,state_name)
  VALUES ('MKT-TAMPICO','Tampico','Tampico','Tampico','Tamaulipas')
  ON CONFLICT (market_code) DO UPDATE SET name=EXCLUDED.name
  RETURNING id
), market_row AS (
  SELECT id FROM m UNION ALL SELECT id FROM territory.markets WHERE market_code='MKT-TAMPICO' LIMIT 1
), c AS (
  INSERT INTO operations.cpp(cpp_code,market_id,name,daily_capacity)
  SELECT 'CPP-TAM-01',id,'CPP Tampico 01',30 FROM market_row
  ON CONFLICT (cpp_code) DO UPDATE SET name=EXCLUDED.name
  RETURNING id,market_id
), cpp_row AS (
  SELECT id,market_id FROM c UNION ALL SELECT id,market_id FROM operations.cpp WHERE cpp_code='CPP-TAM-01' LIMIT 1
)
INSERT INTO territory.service_zones(zone_code,market_id,primary_cpp_id,name,min_latitude,max_latitude,min_longitude,max_longitude,delivery_fee,minimum_order,daily_capacity)
SELECT 'ZN-TAM-PILOT',market_id,id,'Zona Piloto Tampico',22.180000,22.310000,-97.930000,-97.780000,35.00,180.00,30 FROM cpp_row
ON CONFLICT (zone_code) DO NOTHING;
