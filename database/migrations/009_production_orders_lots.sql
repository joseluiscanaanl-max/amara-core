BEGIN;

CREATE SCHEMA IF NOT EXISTS production;

INSERT INTO core.business_sequences(sequence_code,prefix,current_value,padding,updated_at)
VALUES
  ('PRODUCTION_ORDER','OP-',0,8,NOW()),
  ('PRODUCTION_LOT','LOT-',0,8,NOW())
ON CONFLICT (sequence_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS production.production_orders (
  id UUID PRIMARY KEY,
  production_order_code VARCHAR(24) NOT NULL UNIQUE,
  master_order_id UUID NOT NULL REFERENCES planning.master_production_orders(id),
  demand_line_id UUID NOT NULL REFERENCES planning.production_demand_lines(id),
  cpp_id UUID NOT NULL REFERENCES operations.cpp(id),
  service_date DATE NOT NULL,
  dish_id UUID NOT NULL REFERENCES menu.dishes(id),
  recipe_version_id UUID NOT NULL REFERENCES menu.recipe_versions(id),
  dish_code VARCHAR(20) NOT NULL,
  dish_name_snapshot VARCHAR(150) NOT NULL,
  presentation_snapshot VARCHAR(100) NOT NULL,
  planned_quantity INTEGER NOT NULL,
  actual_quantity INTEGER,
  waste_quantity INTEGER NOT NULL DEFAULT 0,
  status_code VARCHAR(30) NOT NULL DEFAULT 'READY',
  scheduled_start_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  responsible_user_id UUID REFERENCES core.internal_users(id),
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_production_order_quantities CHECK (
    planned_quantity > 0 AND
    (actual_quantity IS NULL OR actual_quantity >= 0) AND
    waste_quantity >= 0 AND
    (actual_quantity IS NULL OR waste_quantity <= actual_quantity + waste_quantity)
  ),
  UNIQUE(demand_line_id)
);

CREATE TABLE IF NOT EXISTS production.production_lots (
  id UUID PRIMARY KEY,
  lot_code VARCHAR(24) NOT NULL UNIQUE,
  production_order_id UUID NOT NULL REFERENCES production.production_orders(id),
  cpp_id UUID NOT NULL REFERENCES operations.cpp(id),
  dish_id UUID NOT NULL REFERENCES menu.dishes(id),
  recipe_version_id UUID NOT NULL REFERENCES menu.recipe_versions(id),
  service_date DATE NOT NULL,
  quantity_produced INTEGER NOT NULL,
  quantity_available INTEGER NOT NULL DEFAULT 0,
  quantity_rejected INTEGER NOT NULL DEFAULT 0,
  status_code VARCHAR(30) NOT NULL DEFAULT 'PENDING_QUALITY',
  produced_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  traceability JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_production_lot_quantities CHECK (
    quantity_produced > 0 AND quantity_available >= 0 AND quantity_rejected >= 0 AND
    quantity_available + quantity_rejected <= quantity_produced
  ),
  UNIQUE(production_order_id)
);

CREATE TABLE IF NOT EXISTS production.production_waste (
  id UUID PRIMARY KEY,
  production_order_id UUID NOT NULL REFERENCES production.production_orders(id),
  lot_id UUID REFERENCES production.production_lots(id),
  quantity INTEGER NOT NULL,
  reason_code VARCHAR(60) NOT NULL,
  notes TEXT,
  recorded_by UUID REFERENCES core.internal_users(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_production_waste_quantity CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS ix_production_orders_cpp_date_status
ON production.production_orders(cpp_id,service_date,status_code);
CREATE INDEX IF NOT EXISTS ix_production_orders_master
ON production.production_orders(master_order_id);
CREATE INDEX IF NOT EXISTS ix_production_lots_cpp_date_status
ON production.production_lots(cpp_id,service_date,status_code);
CREATE INDEX IF NOT EXISTS ix_production_waste_order
ON production.production_waste(production_order_id);

COMMIT;
