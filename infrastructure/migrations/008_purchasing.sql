CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL, tax_id TEXT, contact_name TEXT, phone TEXT, email TEXT, address TEXT, notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_company_tax_idx ON suppliers(company_id, tax_id) WHERE tax_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS branch_purchase_sequences (
  branch_id UUID PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE, next_folio BIGINT NOT NULL DEFAULT 1 CHECK (next_folio > 0)
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id), branch_id UUID NOT NULL REFERENCES branches(id),
  supplier_id UUID NOT NULL REFERENCES suppliers(id), folio BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
  expected_at DATE, notes TEXT, idempotency_key TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, folio), UNIQUE (company_id, branch_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS purchase_orders_branch_status_idx ON purchase_orders(branch_id, status, created_at DESC);
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id), quantity NUMERIC(20,8) NOT NULL CHECK (quantity > 0),
  unit_id UUID NOT NULL REFERENCES units(id), unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  received_quantity NUMERIC(20,8) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  UNIQUE (purchase_order_id, ingredient_id)
);
CREATE TABLE IF NOT EXISTS purchase_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id), branch_id UUID NOT NULL REFERENCES branches(id),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id), warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  received_by UUID NOT NULL REFERENCES users(id), received_at TIMESTAMPTZ NOT NULL DEFAULT now(), notes TEXT,
  idempotency_key TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_receipts_order_idx ON purchase_receipts(purchase_order_id, created_at DESC);
CREATE TABLE IF NOT EXISTS purchase_receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), purchase_receipt_id UUID NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  purchase_order_item_id UUID NOT NULL REFERENCES purchase_order_items(id), ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  quantity_received NUMERIC(20,8) NOT NULL CHECK (quantity_received > 0), unit_id UUID NOT NULL REFERENCES units(id),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0)
);
CREATE TABLE IF NOT EXISTS ingredient_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id), branch_id UUID NOT NULL REFERENCES branches(id),
  ingredient_id UUID NOT NULL REFERENCES ingredients(id), unit_id UUID NOT NULL REFERENCES units(id), unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  source TEXT NOT NULL CHECK (source IN ('PURCHASE','ADJUSTMENT')), purchase_receipt_id UUID REFERENCES purchase_receipts(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ingredient_costs_ingredient_idx ON ingredient_costs(company_id, ingredient_id, occurred_at DESC);

INSERT INTO permissions (code, description) VALUES
 ('purchase.read','Consultar compras y proveedores'), ('purchase.manage','Administrar proveedores y ordenes de compra'),
 ('purchase.receive','Registrar recepciones de compra')
ON CONFLICT (code) DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('008_purchasing') ON CONFLICT (version) DO NOTHING;