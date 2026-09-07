CREATE TABLE IF NOT EXISTS branch_business_hours (
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  time_from TIME NOT NULL,
  time_to TIME NOT NULL,
  PRIMARY KEY (branch_id, day_of_week),
  CHECK (time_from < time_to)
);

CREATE TABLE IF NOT EXISTS branch_product_hours (
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  time_from TIME NOT NULL,
  time_to TIME NOT NULL,
  PRIMARY KEY (branch_id, product_id, day_of_week, time_from),
  CHECK (time_from < time_to)
);
CREATE INDEX IF NOT EXISTS branch_product_hours_prod_idx ON branch_product_hours(product_id, branch_id);

-- Horario sin filas = sucursal abierta todo el dia.
-- Sin ventanas para un producto = disponible segun branch_product_availability.

INSERT INTO permissions (code, description) VALUES
  ('schedule.manage', 'Administrar horarios y disponibilidad')
ON CONFLICT (code) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES ('010_branch_scheduling')
ON CONFLICT (version) DO NOTHING;