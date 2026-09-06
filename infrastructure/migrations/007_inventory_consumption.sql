ALTER TABLE stock_balances DROP CONSTRAINT IF EXISTS stock_balances_quantity_check;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
DROP INDEX IF EXISTS stock_movements_idempotency_key_idx;
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_idempotency_key_pair_idx ON stock_movements (idempotency_key, movement_type) WHERE idempotency_key IS NOT NULL;
INSERT INTO schema_migrations (version) VALUES ('007_inventory_consumption') ON CONFLICT (version) DO NOTHING;