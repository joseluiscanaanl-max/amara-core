BEGIN;

CREATE SCHEMA IF NOT EXISTS logistics;

INSERT INTO core.business_sequences(sequence_code,prefix,current_value,padding,updated_at)
VALUES
  ('ROUTE','RUT-',0,8,NOW()),
  ('DELIVERY','ENT-',0,10,NOW()),
  ('DELIVERY_INCIDENT','IDL-',0,10,NOW())
ON CONFLICT (sequence_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS logistics.vehicles (
  id UUID PRIMARY KEY,
  vehicle_code VARCHAR(24) NOT NULL UNIQUE,
  cpp_id UUID NOT NULL REFERENCES operations.cpp(id),
  name VARCHAR(100) NOT NULL,
  plate_number VARCHAR(30),
  capacity_orders INTEGER NOT NULL DEFAULT 20,
  status_code VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_vehicle_capacity CHECK (capacity_orders > 0)
);

CREATE TABLE IF NOT EXISTS logistics.routes (
  id UUID PRIMARY KEY,
  route_code VARCHAR(24) NOT NULL UNIQUE,
  cpp_id UUID NOT NULL REFERENCES operations.cpp(id),
  service_date DATE NOT NULL,
  delivery_window_start TIMESTAMPTZ NOT NULL,
  delivery_window_end TIMESTAMPTZ NOT NULL,
  host_user_id UUID REFERENCES core.internal_users(id),
  vehicle_id UUID REFERENCES logistics.vehicles(id),
  max_stops INTEGER NOT NULL DEFAULT 20,
  status_code VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  published_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_route_window CHECK (delivery_window_end > delivery_window_start),
  CONSTRAINT ck_route_max_stops CHECK (max_stops > 0)
);

CREATE TABLE IF NOT EXISTS logistics.route_stops (
  id UUID PRIMARY KEY,
  route_id UUID NOT NULL REFERENCES logistics.routes(id),
  order_id UUID NOT NULL UNIQUE REFERENCES commerce.orders(id),
  packing_order_id UUID NOT NULL UNIQUE REFERENCES packing.packing_orders(id),
  location_id UUID NOT NULL REFERENCES household.locations(id),
  stop_sequence INTEGER NOT NULL,
  estimated_arrival_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status_code VARCHAR(30) NOT NULL DEFAULT 'ASSIGNED',
  waiting_minutes INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(route_id,stop_sequence),
  CONSTRAINT ck_stop_sequence CHECK (stop_sequence > 0),
  CONSTRAINT ck_waiting_minutes CHECK (waiting_minutes >= 0)
);

CREATE TABLE IF NOT EXISTS logistics.deliveries (
  id UUID PRIMARY KEY,
  delivery_code VARCHAR(24) NOT NULL UNIQUE,
  route_stop_id UUID NOT NULL UNIQUE REFERENCES logistics.route_stops(id),
  order_id UUID NOT NULL UNIQUE REFERENCES commerce.orders(id),
  household_id UUID NOT NULL REFERENCES household.households(id),
  location_id UUID NOT NULL REFERENCES household.locations(id),
  cpp_id UUID NOT NULL REFERENCES operations.cpp(id),
  status_code VARCHAR(30) NOT NULL DEFAULT 'ASSIGNED',
  departure_at TIMESTAMPTZ,
  arrival_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  arrival_latitude NUMERIC(9,6),
  arrival_longitude NUMERIC(9,6),
  delivery_latitude NUMERIC(9,6),
  delivery_longitude NUMERIC(9,6),
  receiver_name VARCHAR(150),
  receiver_type_code VARCHAR(40),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  failure_reason_code VARCHAR(60),
  failure_notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS logistics.delivery_incidents (
  id UUID PRIMARY KEY,
  incident_code VARCHAR(24) NOT NULL UNIQUE,
  delivery_id UUID NOT NULL REFERENCES logistics.deliveries(id),
  category_code VARCHAR(60) NOT NULL,
  severity_code VARCHAR(30) NOT NULL DEFAULT 'MEDIUM',
  description TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  status_code VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  reported_by UUID REFERENCES core.internal_users(id),
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_routes_cpp_date_status
ON logistics.routes(cpp_id,service_date,status_code);
CREATE INDEX IF NOT EXISTS ix_route_stops_route_sequence
ON logistics.route_stops(route_id,stop_sequence);
CREATE INDEX IF NOT EXISTS ix_route_stops_status
ON logistics.route_stops(status_code);
CREATE INDEX IF NOT EXISTS ix_deliveries_status
ON logistics.deliveries(status_code,created_at);
CREATE INDEX IF NOT EXISTS ix_delivery_incidents_delivery
ON logistics.delivery_incidents(delivery_id,status_code);

COMMIT;
