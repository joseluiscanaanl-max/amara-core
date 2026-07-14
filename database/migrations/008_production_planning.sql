BEGIN;

CREATE SCHEMA IF NOT EXISTS planning;

INSERT INTO core.business_sequences(sequence_code,prefix,current_value,padding,updated_at)
VALUES ('MASTER_PRODUCTION_ORDER','OMP-',0,8,NOW())
ON CONFLICT (sequence_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS planning.master_production_orders (
  id UUID PRIMARY KEY,
  omp_code VARCHAR(24) NOT NULL UNIQUE,
  cpp_id UUID NOT NULL REFERENCES operations.cpp(id),
  service_date DATE NOT NULL,
  status_code VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  strategic_reserve_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  source_order_count INTEGER NOT NULL DEFAULT 0,
  total_confirmed_units INTEGER NOT NULL DEFAULT 0,
  total_reserve_units INTEGER NOT NULL DEFAULT 0,
  total_production_units INTEGER NOT NULL DEFAULT 0,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by UUID,
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_omp_reserve_percent CHECK (strategic_reserve_percent BETWEEN 0 AND 30),
  CONSTRAINT ck_omp_totals CHECK (
    source_order_count >= 0 AND total_confirmed_units >= 0 AND
    total_reserve_units >= 0 AND total_production_units >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_omp_cpp_date_open
ON planning.master_production_orders(cpp_id, service_date)
WHERE status_code IN ('DRAFT','APPROVED','RELEASED','IN_PROGRESS');

CREATE TABLE IF NOT EXISTS planning.production_demand_lines (
  id UUID PRIMARY KEY,
  master_order_id UUID NOT NULL REFERENCES planning.master_production_orders(id),
  weekly_menu_item_id UUID NOT NULL REFERENCES menu.weekly_menu_items(id),
  dish_id UUID NOT NULL REFERENCES menu.dishes(id),
  recipe_version_id UUID NOT NULL REFERENCES menu.recipe_versions(id),
  dish_code VARCHAR(20) NOT NULL,
  dish_name_snapshot VARCHAR(150) NOT NULL,
  presentation_snapshot VARCHAR(100) NOT NULL,
  confirmed_quantity INTEGER NOT NULL,
  strategic_reserve_quantity INTEGER NOT NULL DEFAULT 0,
  finished_inventory_quantity INTEGER NOT NULL DEFAULT 0,
  production_required_quantity INTEGER NOT NULL,
  menu_capacity INTEGER NOT NULL,
  capacity_remaining_after_plan INTEGER NOT NULL,
  status_code VARCHAR(30) NOT NULL DEFAULT 'PLANNED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_planning_line_quantities CHECK (
    confirmed_quantity >= 0 AND strategic_reserve_quantity >= 0 AND
    finished_inventory_quantity >= 0 AND production_required_quantity >= 0
  ),
  UNIQUE(master_order_id, weekly_menu_item_id)
);

CREATE TABLE IF NOT EXISTS planning.planning_alerts (
  id UUID PRIMARY KEY,
  master_order_id UUID NOT NULL REFERENCES planning.master_production_orders(id),
  demand_line_id UUID REFERENCES planning.production_demand_lines(id),
  alert_code VARCHAR(80) NOT NULL,
  severity_code VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  details JSONB,
  status_code VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_omp_cpp_date_status
ON planning.master_production_orders(cpp_id,service_date,status_code);
CREATE INDEX IF NOT EXISTS ix_planning_lines_master
ON planning.production_demand_lines(master_order_id);
CREATE INDEX IF NOT EXISTS ix_planning_alerts_master_status
ON planning.planning_alerts(master_order_id,status_code);

COMMIT;
