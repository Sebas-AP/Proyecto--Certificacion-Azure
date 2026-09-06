ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check CHECK (movement_type IN ('PURCHASE','THEORETICAL_CONSUMPTION','WASTE','POSITIVE_ADJUSTMENT','NEGATIVE_ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT','COUNT','RETURN'));

CREATE TABLE IF NOT EXISTS purchase_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id), branch_id UUID NOT NULL REFERENCES branches(id),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id), warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  returned_by UUID NOT NULL REFERENCES users(id), notes TEXT, idempotency_key TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_returns_order_idx ON purchase_returns(purchase_order_id, created_at DESC);
CREATE TABLE IF NOT EXISTS purchase_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), purchase_return_id UUID NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  purchase_order_item_id UUID NOT NULL REFERENCES purchase_order_items(id), ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  quantity_returned NUMERIC(20,8) NOT NULL CHECK (quantity_returned > 0), unit_id UUID NOT NULL REFERENCES units(id)
);

ALTER TABLE ingredient_costs ADD COLUMN IF NOT EXISTS quantity_base NUMERIC(20,8) NOT NULL DEFAULT 1 CHECK (quantity_base > 0);
ALTER TABLE ingredient_costs ADD COLUMN IF NOT EXISTS total_cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_cost >= 0);

INSERT INTO schema_migrations (version) VALUES ('009_purchasing_returns') ON CONFLICT (version) DO NOTHING;