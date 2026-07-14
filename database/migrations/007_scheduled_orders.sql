BEGIN;

CREATE SCHEMA IF NOT EXISTS commerce;

INSERT INTO core.business_sequences(sequence_code,prefix,current_value,padding,updated_at)
VALUES ('ORDER','PED-',0,8,NOW())
ON CONFLICT (sequence_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS commerce.orders (
  id UUID PRIMARY KEY,
  order_code VARCHAR(24) NOT NULL UNIQUE,
  client_request_id UUID NOT NULL UNIQUE,
  household_id UUID NOT NULL REFERENCES household.households(id),
  location_id UUID NOT NULL REFERENCES household.locations(id),
  market_id UUID NOT NULL REFERENCES territory.markets(id),
  zone_id UUID NOT NULL REFERENCES territory.service_zones(id),
  cpp_id UUID NOT NULL REFERENCES operations.cpp(id),
  weekly_menu_id UUID NOT NULL REFERENCES menu.weekly_menus(id),
  service_date DATE NOT NULL,
  delivery_window_start TIMESTAMPTZ NOT NULL,
  delivery_window_end TIMESTAMPTZ NOT NULL,
  status_code VARCHAR(30) NOT NULL DEFAULT 'CONFIRMED',
  subtotal NUMERIC(12,2) NOT NULL,
  delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'MXN',
  notes TEXT,
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_order_amounts CHECK (subtotal >= 0 AND delivery_fee >= 0 AND discount_total >= 0 AND total >= 0),
  CONSTRAINT ck_order_delivery_window CHECK (delivery_window_end > delivery_window_start)
);

CREATE TABLE IF NOT EXISTS commerce.order_items (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES commerce.orders(id),
  weekly_menu_item_id UUID NOT NULL REFERENCES menu.weekly_menu_items(id),
  dish_id UUID NOT NULL REFERENCES menu.dishes(id),
  recipe_version_id UUID NOT NULL REFERENCES menu.recipe_versions(id),
  dish_name_snapshot VARCHAR(150) NOT NULL,
  presentation_snapshot VARCHAR(100) NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL,
  quantity INTEGER NOT NULL,
  line_total NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_order_item_quantity CHECK (quantity > 0),
  CONSTRAINT ck_order_item_amount CHECK (unit_price >= 0 AND line_total >= 0),
  UNIQUE(order_id, weekly_menu_item_id)
);

CREATE INDEX IF NOT EXISTS ix_orders_household_date ON commerce.orders(household_id,service_date DESC);
CREATE INDEX IF NOT EXISTS ix_orders_cpp_date_status ON commerce.orders(cpp_id,service_date,status_code);
CREATE INDEX IF NOT EXISTS ix_orders_location_date ON commerce.orders(location_id,service_date);
CREATE INDEX IF NOT EXISTS ix_order_items_order ON commerce.order_items(order_id);
CREATE INDEX IF NOT EXISTS ix_order_items_menu_item ON commerce.order_items(weekly_menu_item_id);

COMMIT;
