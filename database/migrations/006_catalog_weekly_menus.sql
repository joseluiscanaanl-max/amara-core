BEGIN;
CREATE SCHEMA IF NOT EXISTS menu;

INSERT INTO core.business_sequences(sequence_code,prefix,current_value,padding,updated_at)
VALUES ('DISH','PLA-',0,6,NOW()),('RECIPE','REC-',0,6,NOW()),('MENU','MEN-',0,6,NOW())
ON CONFLICT (sequence_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS menu.dishes (
 id UUID PRIMARY KEY,
 dish_code VARCHAR(20) NOT NULL UNIQUE,
 name VARCHAR(150) NOT NULL,
 description TEXT,
 category_code VARCHAR(50),
 image_url TEXT,
 shelf_life_hours INTEGER,
 status_code VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
 version INTEGER NOT NULL DEFAULT 1,
 is_active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu.recipe_versions (
 id UUID PRIMARY KEY,
 recipe_code VARCHAR(20) NOT NULL,
 dish_id UUID NOT NULL REFERENCES menu.dishes(id),
 version_number INTEGER NOT NULL,
 yield_quantity NUMERIC(12,3) NOT NULL,
 yield_unit VARCHAR(30) NOT NULL,
 estimated_cost NUMERIC(12,2),
 instructions TEXT,
 status_code VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
 approved_at TIMESTAMPTZ,
 valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 valid_until TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(dish_id,version_number)
);

CREATE TABLE IF NOT EXISTS menu.weekly_menus (
 id UUID PRIMARY KEY,
 menu_code VARCHAR(30) NOT NULL UNIQUE,
 market_id UUID NOT NULL REFERENCES territory.markets(id),
 cpp_id UUID NOT NULL REFERENCES operations.cpp(id),
 starts_on DATE NOT NULL,
 ends_on DATE NOT NULL,
 order_cutoff_at TIMESTAMPTZ,
 message TEXT,
 status_code VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
 published_at TIMESTAMPTZ,
 version INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT ck_weekly_menu_dates CHECK (ends_on >= starts_on)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_weekly_menu_cpp_period_active
ON menu.weekly_menus(cpp_id, starts_on, ends_on)
WHERE status_code IN ('APPROVED','PUBLISHED');

CREATE TABLE IF NOT EXISTS menu.weekly_menu_items (
 id UUID PRIMARY KEY,
 weekly_menu_id UUID NOT NULL REFERENCES menu.weekly_menus(id),
 dish_id UUID NOT NULL REFERENCES menu.dishes(id),
 recipe_version_id UUID NOT NULL REFERENCES menu.recipe_versions(id),
 service_date DATE NOT NULL,
 presentation_name VARCHAR(100) NOT NULL,
 price NUMERIC(12,2) NOT NULL,
 capacity INTEGER NOT NULL,
 reserved_quantity INTEGER NOT NULL DEFAULT 0,
 sold_quantity INTEGER NOT NULL DEFAULT 0,
 status_code VARCHAR(30) NOT NULL DEFAULT 'AVAILABLE',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT ck_menu_item_capacity CHECK (capacity >= 0 AND reserved_quantity >= 0 AND sold_quantity >= 0),
 CONSTRAINT ck_menu_item_not_over_capacity CHECK (reserved_quantity + sold_quantity <= capacity)
);
CREATE INDEX IF NOT EXISTS ix_weekly_menu_items_menu_date ON menu.weekly_menu_items(weekly_menu_id,service_date);
CREATE INDEX IF NOT EXISTS ix_weekly_menus_cpp_status ON menu.weekly_menus(cpp_id,status_code,starts_on,ends_on);

COMMIT;
