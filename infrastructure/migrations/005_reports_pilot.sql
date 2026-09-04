CREATE INDEX IF NOT EXISTS orders_reports_scope_idx
  ON orders (company_id, branch_id, created_at, status);
CREATE INDEX IF NOT EXISTS payments_reports_scope_idx
  ON payments (company_id, branch_id, created_at, method);
CREATE INDEX IF NOT EXISTS branch_product_availability_reports_idx
  ON branch_product_availability (branch_id, is_available, product_id);

INSERT INTO permissions (code, description) VALUES
  ('report.branch.read', 'Consultar reportes de una sucursal'),
  ('report.company.read', 'Consultar reportes de la empresa en sucursales autorizadas'),
  ('export.read', 'Exportar reportes')
ON CONFLICT (code) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES ('005_reports_pilot')
ON CONFLICT (version) DO NOTHING;