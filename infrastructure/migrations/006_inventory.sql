CREATE TABLE IF NOT EXISTS units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID REFERENCES companies(id),
  code TEXT NOT NULL, name TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);
CREATE TABLE IF NOT EXISTS unit_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID REFERENCES companies(id),
  from_unit_id UUID NOT NULL REFERENCES units(id), to_unit_id UUID NOT NULL REFERENCES units(id),
  factor NUMERIC(20,8) NOT NULL CHECK (factor > 0),
  UNIQUE (company_id, from_unit_id, to_unit_id), CHECK (from_unit_id <> to_unit_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS units_global_code_idx ON units (code) WHERE company_id IS NULL;
INSERT INTO units (company_id, code, name) VALUES
  (NULL, 'KG', 'Kilogramo'), (NULL, 'G', 'Gramo'), (NULL, 'L', 'Litro'),
  (NULL, 'ML', 'Mililitro'), (NULL, 'UNIT', 'Unidad')
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL, sku TEXT, base_unit_id UUID NOT NULL REFERENCES units(id),
  is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name), UNIQUE (company_id, sku)
);
CREATE TABLE IF NOT EXISTS warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id), branch_id UUID NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, name)
);
CREATE TABLE IF NOT EXISTS stock_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id), branch_id UUID NOT NULL REFERENCES branches(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id), ingredient_id UUID NOT NULL REFERENCES ingredients(id), quantity NUMERIC(20,8) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (warehouse_id, ingredient_id)
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id), branch_id UUID NOT NULL REFERENCES branches(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id), ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('PURCHASE','THEORETICAL_CONSUMPTION','WASTE','POSITIVE_ADJUSTMENT','NEGATIVE_ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT','COUNT')),
  quantity NUMERIC(20,8) NOT NULL CHECK (quantity > 0), unit_id UUID NOT NULL REFERENCES units(id), reason TEXT NOT NULL,
  reference_id UUID, created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_movements_scope_idx ON stock_movements(company_id, branch_id, created_at DESC);
CREATE TABLE IF NOT EXISTS recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id), branch_id UUID REFERENCES branches(id),
  name TEXT NOT NULL, product_id UUID REFERENCES products(id), is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (company_id, name)
);
CREATE TABLE IF NOT EXISTS recipe_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), recipe_id UUID NOT NULL REFERENCES recipes(id), version INTEGER NOT NULL,
  notes TEXT, created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, version)
);
CREATE TABLE IF NOT EXISTS recipe_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), recipe_version_id UUID NOT NULL REFERENCES recipe_versions(id), ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  quantity NUMERIC(20,8) NOT NULL CHECK (quantity > 0), unit_id UUID NOT NULL REFERENCES units(id),
  UNIQUE (recipe_version_id, ingredient_id)
);
CREATE TABLE IF NOT EXISTS waste_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id), branch_id UUID NOT NULL REFERENCES branches(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id), ingredient_id UUID NOT NULL REFERENCES ingredients(id), quantity NUMERIC(20,8) NOT NULL CHECK (quantity > 0),
  unit_id UUID NOT NULL REFERENCES units(id), reason TEXT NOT NULL, movement_id UUID REFERENCES stock_movements(id), created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stock_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id), branch_id UUID NOT NULL REFERENCES branches(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id), status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','COMPLETED')),
  notes TEXT, created_by UUID NOT NULL REFERENCES users(id), completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stock_count_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), stock_count_id UUID NOT NULL REFERENCES stock_counts(id), ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  expected_quantity NUMERIC(20,8) NOT NULL, counted_quantity NUMERIC(20,8) NOT NULL CHECK (counted_quantity >= 0), unit_id UUID NOT NULL REFERENCES units(id),
  UNIQUE (stock_count_id, ingredient_id)
);

CREATE OR REPLACE FUNCTION prevent_inventory_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'inventory records are immutable'; END; $$;
DROP TRIGGER IF EXISTS stock_movements_immutable ON stock_movements;
CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION prevent_inventory_immutable_change();
DROP TRIGGER IF EXISTS stock_counts_immutable ON stock_counts;
CREATE TRIGGER stock_counts_immutable BEFORE DELETE ON stock_counts FOR EACH ROW EXECUTE FUNCTION prevent_inventory_immutable_change();

INSERT INTO permissions (code, description) VALUES
 ('inventory.read','Consultar inventario'), ('inventory.manage','Administrar inventario'), ('inventory.adjust','Ajustar existencias'),
 ('recipe.read','Consultar recetas'), ('recipe.manage','Administrar recetas')
ON CONFLICT (code) DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('006_inventory') ON CONFLICT (version) DO NOTHING;