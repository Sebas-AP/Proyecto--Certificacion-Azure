import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

process.env.DATABASE_URL ??= 'postgres://gorditas:gorditas@localhost:5432/gorditasos';
process.env.SESSION_SECRET ??= 'test-session-secret-that-is-long-enough';

import { pool } from '../apps/api/src/db.js';
import { createSession } from '../apps/api/src/auth.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../infrastructure/migrations/', import.meta.url));
const MIGRATIONS = [
  '001_initial_core.sql',
  '002_catalog_orders.sql',
  '003_kitchen.sql',
  '004_cash_payments.sql',
  '005_reports_pilot.sql',
  '006_inventory.sql',
  '007_inventory_consumption.sql',
  '008_purchasing.sql',
];

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    const applied = await client.query('SELECT version FROM schema_migrations');
    const versions = new Set(applied.rows.map((row: { version: string }) => row.version));
    for (const file of MIGRATIONS) {
      if (versions.has(file.replace('.sql', ''))) continue;
      await client.query(readFileSync(`${MIGRATIONS_DIR}${file}`, 'utf8'));
    }
  } finally {
    client.release();
  }
}

export type TestEnvironment = {
  companyId: string;
  branchId: string;
  branchTwoId: string;
  userId: string;
  userTwoId: string;
  categoryId: string;
  productId: string;
  variantId: string;
  tableId: string;
  email: string;
  password: string;
};

export async function seedTestEnvironment(): Promise<TestEnvironment> {
  const password = 'PruebaSegura$2026';
  const passwordHash = await bcrypt.hash(password, 4);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const company = await client.query('INSERT INTO companies (name) VALUES (\'Empresa de prueba\') RETURNING id');
    const branch = await client.query(`INSERT INTO branches (company_id, name, code, timezone) VALUES ($1,'Sucursal prueba','PRUEBA','America/Mexico_City') RETURNING id`, [company.rows[0].id]);
    const branchTwo = await client.query(`INSERT INTO branches (company_id, name, code, timezone) VALUES ($1,'Sucursal prueba 2','PRUEBA2','America/Mexico_City') RETURNING id`, [company.rows[0].id]);
    const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1,'Administrador de prueba') RETURNING id`, [company.rows[0].id]);
    await client.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions ON CONFLICT DO NOTHING', [role.rows[0].id]);
    const user = await client.query(`INSERT INTO users (company_id, email, display_name, password_hash) VALUES ($1,$2,'Usuario de prueba',$3) RETURNING id`, [company.rows[0].id, 'integracion@prueba.local', passwordHash]);
    await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [user.rows[0].id, role.rows[0].id]);
    await client.query('INSERT INTO user_branches (user_id, branch_id) VALUES ($1,$2),($1,$3) ON CONFLICT DO NOTHING', [user.rows[0].id, branch.rows[0].id, branchTwo.rows[0].id]);

    const roleTwo = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1,'Solo lectura') RETURNING id`, [company.rows[0].id]);
    await client.query(`INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code IN ('branch.read','cash.read','kitchen.read','order.read','catalog.read','inventory.read','recipe.read') ON CONFLICT DO NOTHING`, [roleTwo.rows[0].id]);
    const userTwo = await client.query(`INSERT INTO users (company_id, email, display_name, password_hash) VALUES ($1,$2,'Usuario limitado',$3) RETURNING id`, [company.rows[0].id, 'limitado@prueba.local', passwordHash]);
    await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userTwo.rows[0].id, roleTwo.rows[0].id]);
    await client.query('INSERT INTO user_branches (user_id, branch_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userTwo.rows[0].id, branchTwo.rows[0].id]);

    const category = await client.query(`INSERT INTO categories (company_id, name, sort_order) VALUES ($1,'Gorditas de prueba',1) RETURNING id`, [company.rows[0].id]);
    const product = await client.query(`INSERT INTO products (company_id, category_id, name, sku) VALUES ($1,$2,'Gordita de prueba','PRUEBA-GORDITA') RETURNING id`, [company.rows[0].id, category.rows[0].id]);
    const variant = await client.query(`INSERT INTO product_variants (product_id, name, price, is_default) VALUES ($1,'Sencilla',35,true) RETURNING id`, [product.rows[0].id]);
    await client.query(`INSERT INTO product_variants (product_id, name, price) VALUES ($1,'Especial',45)`, [product.rows[0].id]);
    await client.query('INSERT INTO product_prices (variant_id, price) VALUES ($1,35)', [variant.rows[0].id]);
    await client.query(`INSERT INTO branch_product_availability (branch_id, product_id, is_available, updated_by) VALUES ($1,$2,true,$3)`, [branch.rows[0].id, product.rows[0].id, user.rows[0].id]);
    const table = await client.query(`INSERT INTO restaurant_tables (company_id, branch_id, name, capacity) VALUES ($1,$2,'Mesa 1',4) RETURNING id`, [company.rows[0].id, branch.rows[0].id]);
    await client.query(`INSERT INTO payment_method_configs (company_id, method) VALUES ($1,'CASH'),($1,'CARD'),($1,'TRANSFER') ON CONFLICT (company_id, method) DO NOTHING`, [company.rows[0].id]);
    await client.query('COMMIT');
    return {
      companyId: company.rows[0].id,
      branchId: branch.rows[0].id,
      branchTwoId: branchTwo.rows[0].id,
      userId: user.rows[0].id,
      userTwoId: userTwo.rows[0].id,
      categoryId: category.rows[0].id,
      productId: product.rows[0].id,
      variantId: variant.rows[0].id,
      tableId: table.rows[0].id,
      email: 'integracion@prueba.local',
      password,
    };
  } finally {
    client.release();
  }
}

async function deleteCompanyData(client: { query: (text: string, values?: unknown[]) => Promise<unknown> }, companyId: string): Promise<void> {
  await client.query(`ALTER TABLE cash_movements DISABLE TRIGGER cash_movements_no_delete`);
  await client.query(`ALTER TABLE payments DISABLE TRIGGER payments_no_delete`);
  await client.query(`ALTER TABLE stock_movements DISABLE TRIGGER stock_movements_immutable`);
  await client.query(`ALTER TABLE stock_counts DISABLE TRIGGER stock_counts_immutable`);
  await client.query(`DELETE FROM audit_logs WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM refunds WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM cash_movements WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM payments WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM cash_sessions WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM cash_registers WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM cash_payments WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM stock_count_items WHERE stock_count_id IN (SELECT id FROM stock_counts WHERE company_id=$1)`, [companyId]);
  await client.query(`DELETE FROM stock_counts WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM waste_records WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM stock_movements WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM stock_balances WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM ingredient_costs WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM purchase_receipt_items WHERE purchase_receipt_id IN (SELECT id FROM purchase_receipts WHERE company_id=$1)`, [companyId]);
  await client.query(`DELETE FROM purchase_receipts WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM purchase_order_items WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE company_id=$1)`, [companyId]);
  await client.query(`DELETE FROM purchase_orders WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM suppliers WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM recipe_items WHERE recipe_version_id IN (SELECT rv.id FROM recipe_versions rv JOIN recipes r ON r.id=rv.recipe_id WHERE r.company_id=$1)`, [companyId]);
  await client.query(`DELETE FROM recipe_versions WHERE recipe_id IN (SELECT id FROM recipes WHERE company_id=$1)`, [companyId]);
  await client.query(`DELETE FROM recipes WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM warehouses WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM ingredients WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM shifts WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM cash_payments WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM order_item_modifiers WHERE order_item_id IN (SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.company_id=$1)`, [companyId]);
  await client.query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE company_id=$1)`, [companyId]);
  await client.query(`DELETE FROM orders WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM branch_product_availability WHERE branch_id IN (SELECT id FROM branches WHERE company_id=$1)`, [companyId]);
  await client.query(`DELETE FROM restaurant_tables WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM product_prices WHERE variant_id IN (SELECT pv.id FROM product_variants pv JOIN products p ON p.id=pv.product_id WHERE p.company_id=$1)`, [companyId]);
  await client.query(`DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE company_id=$1)`, [companyId]);
  await client.query(`DELETE FROM products WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM categories WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id=$1)`, [companyId]);
  await client.query(`DELETE FROM user_branches WHERE user_id IN (SELECT id FROM users WHERE company_id=$1)`, [companyId]);
  await client.query(`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE company_id=$1)`, [companyId]);
  await client.query(`DELETE FROM users WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id=$1)`, [companyId]);
  await client.query(`DELETE FROM user_branches WHERE branch_id IN (SELECT id FROM branches WHERE company_id=$1)`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM roles WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM payment_method_configs WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM branch_purchase_sequences WHERE branch_id IN (SELECT id FROM branches WHERE company_id=$1)`, [companyId]);
  await client.query(`DELETE FROM unit_conversions WHERE company_id=$1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id=$1`, [companyId]);
  await client.query(`ALTER TABLE stock_counts ENABLE TRIGGER stock_counts_immutable`);
  await client.query(`ALTER TABLE stock_movements ENABLE TRIGGER stock_movements_immutable`);
  await client.query(`ALTER TABLE payments ENABLE TRIGGER payments_no_delete`);
  await client.query(`ALTER TABLE cash_movements ENABLE TRIGGER cash_movements_no_delete`);
}

export async function cleanupTestEnvironment(companyId: string): Promise<void> {
  if (!companyId) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await deleteCompanyData(client, companyId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function purgeTestEnvironments(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leftover = await client.query(`SELECT id FROM companies WHERE name='Empresa de prueba'`);
    for (const row of leftover.rows as { id: string }[]) {
      await deleteCompanyData(client, row.id);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function sessionFor(userId: string): Promise<string> {
  const token = await createSession(userId);
  return `session=${token}`;
}

export async function closePool(): Promise<void> {
  await pool.end();
}