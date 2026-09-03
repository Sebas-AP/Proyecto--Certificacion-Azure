CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL, description TEXT, sort_order INTEGER NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  category_id UUID NOT NULL REFERENCES categories(id), name TEXT NOT NULL, description TEXT,
  sku TEXT, is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, sku)
);
CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL, price NUMERIC(12,2) NOT NULL CHECK (price >= 0), is_default BOOLEAN NOT NULL DEFAULT false, is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (product_id, name)
);
CREATE TABLE IF NOT EXISTS modifier_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id), name TEXT NOT NULL,
  min_selections INTEGER NOT NULL DEFAULT 0 CHECK (min_selections >= 0), max_selections INTEGER CHECK (max_selections IS NULL OR max_selections >= min_selections), is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (company_id, name)
);
CREATE TABLE IF NOT EXISTS modifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), modifier_group_id UUID NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL, price_delta NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price_delta >= 0), is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (modifier_group_id, name)
);
CREATE TABLE IF NOT EXISTS product_modifier_groups (
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE, modifier_group_id UUID NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (product_id, modifier_group_id)
);
CREATE TABLE IF NOT EXISTS product_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0), valid_from TIMESTAMPTZ NOT NULL DEFAULT now(), valid_to TIMESTAMPTZ,
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_current_product_price ON product_prices(variant_id) WHERE valid_to IS NULL;
CREATE TABLE IF NOT EXISTS branch_product_availability (
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE, product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  is_available BOOLEAN NOT NULL DEFAULT true, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by UUID REFERENCES users(id), PRIMARY KEY (branch_id, product_id)
);

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id), branch_id UUID NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL, capacity INTEGER NOT NULL CHECK (capacity > 0), status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','OCCUPIED','DISABLED')),
  UNIQUE (branch_id, name)
);
CREATE TABLE IF NOT EXISTS branch_order_sequences (
  branch_id UUID PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE, next_folio BIGINT NOT NULL DEFAULT 1 CHECK (next_folio > 0)
);
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id), branch_id UUID NOT NULL REFERENCES branches(id),
  table_id UUID REFERENCES restaurant_tables(id), folio BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','CONFIRMED','SENT_TO_KITCHEN','CANCELLATION_REQUESTED','CANCELLED','COMPLETED')),
  channel TEXT NOT NULL DEFAULT 'DINE_IN' CHECK (channel IN ('DINE_IN','TAKEOUT','DELIVERY')), notes TEXT, total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  idempotency_key TEXT NOT NULL, created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, folio), UNIQUE (company_id, branch_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id UUID NOT NULL REFERENCES products(id), variant_id UUID NOT NULL REFERENCES product_variants(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0), product_name TEXT NOT NULL, variant_name TEXT NOT NULL, unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0), notes TEXT, sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_item_modifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE, modifier_id UUID NOT NULL REFERENCES modifiers(id), name TEXT NOT NULL, price_delta NUMERIC(12,2) NOT NULL CHECK (price_delta >= 0)
);
CREATE TABLE IF NOT EXISTS order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE, event_type TEXT NOT NULL,
  from_status TEXT, to_status TEXT, actor_id UUID REFERENCES users(id), reason TEXT, idempotency_key TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, event_type, idempotency_key)
);

INSERT INTO permissions (code, description) VALUES
 ('catalog.read','Consultar catalogo'), ('catalog.manage','Administrar catalogo'), ('order.read','Consultar pedidos'),
 ('order.create','Crear pedidos'), ('order.manage','Administrar pedidos'), ('kitchen.send','Enviar pedidos a cocina')
ON CONFLICT (code) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES ('002_catalog_orders')
ON CONFLICT (version) DO NOTHING;