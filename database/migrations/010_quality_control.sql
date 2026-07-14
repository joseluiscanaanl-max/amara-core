BEGIN;

CREATE SCHEMA IF NOT EXISTS quality;

INSERT INTO core.business_sequences(sequence_code,prefix,current_value,padding,updated_at)
VALUES ('QUALITY_INSPECTION','QC-',0,8,NOW())
ON CONFLICT (sequence_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS quality.checklist_definitions (
  id UUID PRIMARY KEY,
  check_code VARCHAR(60) NOT NULL UNIQUE,
  label VARCHAR(150) NOT NULL,
  description TEXT,
  value_type VARCHAR(30) NOT NULL DEFAULT 'PASS_FAIL',
  unit_code VARCHAR(30),
  is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO quality.checklist_definitions(
  id,check_code,label,description,value_type,unit_code,is_mandatory,sort_order
)
VALUES
  (gen_random_uuid(),'APPEARANCE','Apariencia','Color, presentación y ausencia de contaminación visible.','PASS_FAIL',NULL,TRUE,10),
  (gen_random_uuid(),'TEMPERATURE','Temperatura','Temperatura medida conforme a la ficha técnica.','NUMERIC','CELSIUS',TRUE,20),
  (gen_random_uuid(),'WEIGHT','Peso o rendimiento','Validación del peso o rendimiento del lote.','NUMERIC','UNIT',TRUE,30),
  (gen_random_uuid(),'TEXTURE','Textura','Textura conforme al estándar del platillo.','PASS_FAIL',NULL,TRUE,40),
  (gen_random_uuid(),'FLAVOR','Sabor','Sabor conforme a receta aprobada.','PASS_FAIL',NULL,TRUE,50),
  (gen_random_uuid(),'LABELING','Identificación','Lote, fecha y datos de trazabilidad correctos.','PASS_FAIL',NULL,TRUE,60),
  (gen_random_uuid(),'SHELF_LIFE','Vida útil','Caducidad y condiciones de conservación definidas.','PASS_FAIL',NULL,TRUE,70),
  (gen_random_uuid(),'SPECIAL_CONDITIONS','Condiciones especiales','Restricciones o controles especiales aplicables.','PASS_FAIL',NULL,FALSE,80)
ON CONFLICT (check_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS quality.inspections (
  id UUID PRIMARY KEY,
  inspection_code VARCHAR(24) NOT NULL UNIQUE,
  lot_id UUID NOT NULL REFERENCES production.production_lots(id),
  cpp_id UUID NOT NULL REFERENCES operations.cpp(id),
  status_code VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  decision_code VARCHAR(30),
  approved_quantity INTEGER NOT NULL DEFAULT 0,
  rejected_quantity INTEGER NOT NULL DEFAULT 0,
  hold_reason TEXT,
  decision_reason TEXT,
  inspector_user_id UUID REFERENCES core.internal_users(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_quality_inspection_quantities CHECK (
    approved_quantity >= 0 AND rejected_quantity >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_quality_open_inspection_per_lot
ON quality.inspections(lot_id)
WHERE status_code IN ('OPEN','ON_HOLD');

CREATE TABLE IF NOT EXISTS quality.inspection_checks (
  id UUID PRIMARY KEY,
  inspection_id UUID NOT NULL REFERENCES quality.inspections(id),
  checklist_definition_id UUID NOT NULL REFERENCES quality.checklist_definitions(id),
  result_code VARCHAR(20) NOT NULL,
  numeric_value NUMERIC(14,4),
  text_value TEXT,
  unit_code VARCHAR(30),
  notes TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_by UUID REFERENCES core.internal_users(id),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(inspection_id,checklist_definition_id),
  CONSTRAINT ck_quality_check_result CHECK (result_code IN ('PASS','FAIL','NOT_APPLICABLE'))
);

CREATE INDEX IF NOT EXISTS ix_quality_inspections_cpp_status
ON quality.inspections(cpp_id,status_code,opened_at);
CREATE INDEX IF NOT EXISTS ix_quality_inspections_lot
ON quality.inspections(lot_id);
CREATE INDEX IF NOT EXISTS ix_quality_checks_inspection
ON quality.inspection_checks(inspection_id);

COMMIT;
