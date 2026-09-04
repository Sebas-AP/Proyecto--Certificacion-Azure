CREATE TABLE IF NOT EXISTS cash_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id), branch_id UUID NOT NULL REFERENCES branches(id),
  opened_by UUID NOT NULL REFERENCES users(id), closed_by UUID REFERENCES users(id), status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  opening_cash NUMERIC(12,2) NOT NULL CHECK (opening_cash >= 0), counted_cash NUMERIC(12,2), opening_note TEXT, closing_note TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(), closed_at TIMESTAMPTZ,
  CHECK ((status='OPEN' AND closed_at IS NULL) OR (status='CLOSED' AND closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_cash_session_per_user_branch ON cash_sessions(opened_by, branch_id) WHERE status='OPEN';
CREATE INDEX IF NOT EXISTS cash_sessions_branch_idx ON cash_sessions(branch_id, opened_at DESC);
CREATE TABLE IF NOT EXISTS cash_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id), branch_id UUID NOT NULL REFERENCES branches(id),
  session_id UUID NOT NULL REFERENCES cash_sessions(id), order_id UUID NOT NULL REFERENCES orders(id), method TEXT NOT NULL CHECK (method IN ('CASH','CARD','TRANSFER')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0), idempotency_key TEXT NOT NULL, created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, idempotency_key, method)
);
CREATE INDEX IF NOT EXISTS cash_payments_order_idx ON cash_payments(order_id, created_at);
INSERT INTO permissions (code, description) VALUES
 ('cash.read','Consultar caja'), ('cash.open','Abrir caja'), ('cash.charge','Registrar cobros'), ('cash.close','Cerrar caja')
ON CONFLICT (code) DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('004_cash_payments') ON CONFLICT (version) DO NOTHING;CREATE TABLE IF NOT EXISTS cash_registers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_cash_register_per_branch
  ON cash_registers(branch_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS cash_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  cash_register_id UUID NOT NULL REFERENCES cash_registers(id),
  opened_by UUID NOT NULL REFERENCES users(id),
  closed_by UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  opening_cash NUMERIC(12,2) NOT NULL CHECK (opening_cash >= 0),
  counted_cash NUMERIC(12,2),
  expected_cash NUMERIC(12,2),
  difference NUMERIC(12,2),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  closing_note TEXT,
  CHECK ((status = 'OPEN' AND closed_at IS NULL AND counted_cash IS NULL AND expected_cash IS NULL AND difference IS NULL)
    OR (status = 'CLOSED' AND closed_at IS NOT NULL AND counted_cash IS NOT NULL AND expected_cash IS NOT NULL AND difference IS NOT NULL))
);
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS cash_register_id UUID;
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS expected_cash NUMERIC(12,2);
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS difference NUMERIC(12,2);

INSERT INTO cash_registers (company_id, branch_id, name)
SELECT DISTINCT b.company_id, b.id, 'Caja principal'
FROM branches b
JOIN cash_sessions cs ON cs.branch_id = b.id
ON CONFLICT (branch_id, name) DO NOTHING;
UPDATE cash_sessions cs
SET cash_register_id = cr.id
FROM cash_registers cr
WHERE cr.branch_id = cs.branch_id AND cr.name = 'Caja principal' AND cs.cash_register_id IS NULL;
ALTER TABLE cash_sessions ALTER COLUMN cash_register_id SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_sessions_cash_register_id_fkey') THEN
    ALTER TABLE cash_sessions ADD CONSTRAINT cash_sessions_cash_register_id_fkey
      FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS one_open_cash_session_per_branch
  ON cash_sessions(branch_id) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS cash_sessions_scope_idx ON cash_sessions(company_id, branch_id, opened_at DESC);

CREATE TABLE IF NOT EXISTS cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  cash_session_id UUID NOT NULL REFERENCES cash_sessions(id),
  created_by UUID NOT NULL REFERENCES users(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('IN', 'OUT')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cash_movements_session_idx ON cash_movements(cash_session_id, created_at);

CREATE OR REPLACE FUNCTION prevent_cash_history_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los pagos y movimientos de caja son historicos y no eliminables';
END;
$$;
DROP TRIGGER IF EXISTS cash_movements_no_delete ON cash_movements;
CREATE TRIGGER cash_movements_no_delete BEFORE DELETE ON cash_movements
FOR EACH ROW EXECUTE FUNCTION prevent_cash_history_delete();

CREATE TABLE IF NOT EXISTS payment_method_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  method TEXT NOT NULL CHECK (method IN ('CASH', 'CARD', 'TRANSFER')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (company_id, method)
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  order_id UUID NOT NULL REFERENCES orders(id),
  cash_session_id UUID REFERENCES cash_sessions(id),
  created_by UUID NOT NULL REFERENCES users(id),
  method TEXT NOT NULL CHECK (method IN ('CASH', 'CARD', 'TRANSFER')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  cash_received NUMERIC(12,2),
  change_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, idempotency_key),
  CHECK ((method = 'CASH' AND cash_received IS NOT NULL AND cash_received >= amount AND cash_session_id IS NOT NULL)
    OR (method <> 'CASH' AND cash_received IS NULL AND change_amount = 0))
);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments(order_id, created_at);
CREATE INDEX IF NOT EXISTS payments_scope_idx ON payments(company_id, branch_id, created_at);
DROP TRIGGER IF EXISTS payments_no_delete ON payments;
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION prevent_cash_history_delete();

CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  payment_id UUID NOT NULL REFERENCES payments(id),
  requested_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS refunds_payment_idx ON refunds(payment_id, requested_at);

INSERT INTO payment_method_configs (company_id, method)
SELECT id, method FROM companies CROSS JOIN (VALUES ('CASH'), ('CARD'), ('TRANSFER')) methods(method)
ON CONFLICT (company_id, method) DO NOTHING;

INSERT INTO permissions (code, description) VALUES
 ('cash.read', 'Consultar caja'), ('cash.open', 'Abrir caja'), ('cash.close', 'Cerrar caja'),
 ('cash.move', 'Registrar movimientos de caja'), ('payment.create', 'Registrar pagos'),
 ('payment.refund.request', 'Solicitar reembolsos'), ('payment.refund.approve', 'Aprobar reembolsos')
ON CONFLICT (code) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES ('004_cash_payments')
ON CONFLICT (version) DO NOTHING;