ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS kitchen_status TEXT,
  ADD COLUMN IF NOT EXISTS kitchen_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kitchen_started_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS kitchen_ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kitchen_ready_by UUID REFERENCES users(id);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_kitchen_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_kitchen_status_check
  CHECK (kitchen_status IS NULL OR kitchen_status IN ('PENDING', 'IN_PROGRESS', 'READY'));

UPDATE orders
SET kitchen_status = 'PENDING'
WHERE status = 'SENT_TO_KITCHEN' AND kitchen_status IS NULL;

CREATE INDEX IF NOT EXISTS orders_kitchen_queue_idx
  ON orders (company_id, branch_id, kitchen_status, created_at)
  WHERE kitchen_status IS NOT NULL;

INSERT INTO permissions (code, description) VALUES
  ('kitchen.read', 'Consultar comandas de cocina'),
  ('kitchen.manage', 'Actualizar comandas de cocina')
ON CONFLICT (code) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES ('003_kitchen')
ON CONFLICT (version) DO NOTHING;