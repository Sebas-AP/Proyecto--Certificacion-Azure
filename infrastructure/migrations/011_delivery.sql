-- Fase 11: pedidos digitales (para llevar y domicilio).
-- Clientes, direcciones, zonas de entrega y repartidores.

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  phone TEXT NOT NULL,
  email TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, phone)
);

CREATE TABLE IF NOT EXISTS customer_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  street TEXT NOT NULL,
  neighborhood TEXT,
  city TEXT,
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, label)
);

CREATE TABLE IF NOT EXISTS delivery_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  fee NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS couriers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  type TEXT NOT NULL DEFAULT 'INTERNAL' CHECK (type IN ('INTERNAL','EXTERNAL')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers (company_id, phone);
CREATE INDEX IF NOT EXISTS customer_addresses_customer_idx ON customer_addresses (customer_id);
CREATE INDEX IF NOT EXISTS delivery_zones_company_idx ON delivery_zones (company_id);
CREATE INDEX IF NOT EXISTS couriers_company_idx ON couriers (company_id);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id),
  ADD COLUMN IF NOT EXISTS address_id UUID REFERENCES customer_addresses(id),
  ADD COLUMN IF NOT EXISTS delivery_zone_id UUID REFERENCES delivery_zones(id),
  ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  ADD COLUMN IF NOT EXISTS courier_id UUID REFERENCES couriers(id),
  ADD COLUMN IF NOT EXISTS delivery_status TEXT,
  ADD COLUMN IF NOT EXISTS client_confirmation_token TEXT,
  ADD COLUMN IF NOT EXISTS client_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS client_confirm_method TEXT,
  ADD COLUMN IF NOT EXISTS needs_attention BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attention_reason TEXT;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_delivery_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_delivery_status_check
  CHECK (delivery_status IS NULL OR delivery_status IN ('PENDING','COURIER_ASSIGNED','OUT_FOR_DELIVERY','DELIVERED'));

CREATE INDEX IF NOT EXISTS orders_delivery_queue_idx
  ON orders (company_id, branch_id, channel, delivery_status, created_at)
  WHERE channel = 'DELIVERY' AND delivery_status IS DISTINCT FROM 'DELIVERED';

INSERT INTO permissions (code, description) VALUES
  ('customer.read','Consultar clientes'),
  ('customer.manage','Administrar clientes y direcciones'),
  ('courier.read','Consultar repartidores'),
  ('courier.manage','Administrar repartidores'),
  ('delivery.manage','Administrar entregas y confirmacion de clientes')
ON CONFLICT (code) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES ('011_delivery')
ON CONFLICT (version) DO NOTHING;