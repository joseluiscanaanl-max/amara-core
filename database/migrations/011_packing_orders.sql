BEGIN;

CREATE SCHEMA IF NOT EXISTS packing;

INSERT INTO core.business_sequences(sequence_code,prefix,current_value,padding,updated_at)
VALUES
  ('PACKING_ORDER','EMP-',0,8,NOW()),
  ('PACKING_LABEL','LBL-',0,10,NOW())
ON CONFLICT (sequence_code) DO NOTHING;

ALTER TABLE commerce.order_items
  ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES household.members(id);

CREATE TABLE IF NOT EXISTS packing.checklist_definitions (
  id UUID PRIMARY KEY,
  check_code VARCHAR(60) NOT NULL UNIQUE,
  label VARCHAR(150) NOT NULL,
  description TEXT,
  is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO packing.checklist_definitions(id,check_code,label,description,is_mandatory,sort_order)
VALUES
  (gen_random_uuid(),'ORDER_COMPLETE','Pedido completo','Todos los productos y cantidades del pedido fueron integrados.',TRUE,10),
  (gen_random_uuid(),'CORRECT_LOTS','Lotes correctos','Cada partida utiliza lotes liberados y trazables.',TRUE,20),
  (gen_random_uuid(),'CORRECT_MEMBER','Integrante correcto','Los productos personalizados están identificados para el integrante correcto.',TRUE,30),
  (gen_random_uuid(),'CORRECT_PACKAGING','Empaque correcto','El empaque corresponde al producto y condiciones de conservación.',TRUE,40),
  (gen_random_uuid(),'CORRECT_LABEL','Etiqueta correcta','La etiqueta contiene Hogar, integrante, fecha y trazabilidad necesarias.',TRUE,50),
  (gen_random_uuid(),'COMPLEMENTS_INCLUDED','Complementos incluidos','Se incluyeron complementos e instrucciones aplicables.',TRUE,60),
  (gen_random_uuid(),'TEMPERATURE_VERIFIED','Temperatura verificada','La temperatura de salida fue verificada cuando aplica.',FALSE,70)
ON CONFLICT (check_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS packing.packing_orders (
  id UUID PRIMARY KEY,
  packing_order_code VARCHAR(24) NOT NULL UNIQUE,
  order_id UUID NOT NULL UNIQUE REFERENCES commerce.orders(id),
  household_id UUID NOT NULL REFERENCES household.households(id),
  location_id UUID NOT NULL REFERENCES household.locations(id),
  cpp_id UUID NOT NULL REFERENCES operations.cpp(id),
  service_date DATE NOT NULL,
  status_code VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  responsible_user_id UUID REFERENCES core.internal_users(id),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS packing.packing_order_items (
  id UUID PRIMARY KEY,
  packing_order_id UUID NOT NULL REFERENCES packing.packing_orders(id),
  order_item_id UUID NOT NULL UNIQUE REFERENCES commerce.order_items(id),
  dish_id UUID NOT NULL REFERENCES menu.dishes(id),
  recipe_version_id UUID NOT NULL REFERENCES menu.recipe_versions(id),
  member_id UUID REFERENCES household.members(id),
  dish_name_snapshot VARCHAR(150) NOT NULL,
  presentation_snapshot VARCHAR(100) NOT NULL,
  required_quantity INTEGER NOT NULL,
  allocated_quantity INTEGER NOT NULL DEFAULT 0,
  label_code VARCHAR(30) NOT NULL UNIQUE,
  status_code VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_packing_item_quantities CHECK (
    required_quantity > 0 AND allocated_quantity >= 0 AND allocated_quantity <= required_quantity
  )
);

CREATE TABLE IF NOT EXISTS packing.lot_allocations (
  id UUID PRIMARY KEY,
  packing_order_item_id UUID NOT NULL REFERENCES packing.packing_order_items(id),
  lot_id UUID NOT NULL REFERENCES production.production_lots(id),
  quantity INTEGER NOT NULL,
  allocated_by UUID REFERENCES core.internal_users(id),
  allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_lot_allocation_quantity CHECK (quantity > 0),
  UNIQUE(packing_order_item_id,lot_id)
);

CREATE TABLE IF NOT EXISTS packing.checklist_results (
  id UUID PRIMARY KEY,
  packing_order_id UUID NOT NULL REFERENCES packing.packing_orders(id),
  checklist_definition_id UUID NOT NULL REFERENCES packing.checklist_definitions(id),
  result_code VARCHAR(20) NOT NULL,
  notes TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_by UUID REFERENCES core.internal_users(id),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(packing_order_id,checklist_definition_id),
  CONSTRAINT ck_packing_check_result CHECK (result_code IN ('PASS','FAIL','NOT_APPLICABLE'))
);

CREATE INDEX IF NOT EXISTS ix_packing_orders_cpp_date_status
ON packing.packing_orders(cpp_id,service_date,status_code);
CREATE INDEX IF NOT EXISTS ix_packing_orders_household
ON packing.packing_orders(household_id,service_date DESC);
CREATE INDEX IF NOT EXISTS ix_packing_items_order
ON packing.packing_order_items(packing_order_id);
CREATE INDEX IF NOT EXISTS ix_packing_allocations_lot
ON packing.lot_allocations(lot_id);
CREATE INDEX IF NOT EXISTS ix_packing_checks_order
ON packing.checklist_results(packing_order_id);

COMMIT;
