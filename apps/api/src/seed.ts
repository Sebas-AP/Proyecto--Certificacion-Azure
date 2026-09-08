import bcrypt from 'bcryptjs';
import { pool } from './db.js';

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password || password.length < 12) {
  throw new Error('SEED_ADMIN_PASSWORD debe tener al menos 12 caracteres');
}

const client = await pool.connect();
try {
  await client.query('BEGIN');
  const existingCompany = await client.query(
    `SELECT c.id
     FROM companies c
     WHERE c.name = $1
     ORDER BY (SELECT count(*) FROM products p WHERE p.company_id = c.id) DESC, c.created_at
     LIMIT 1`,
    ['Empresa de demostracion'],
  );
  const companyId = existingCompany.rows[0]?.id ?? (await client.query(
    'INSERT INTO companies (name) VALUES ($1) RETURNING id',
    ['Empresa de demostracion'],
  )).rows[0].id;
  const branch = await client.query(
    `INSERT INTO branches (company_id, name, code, timezone)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [companyId, 'Sucursal piloto', 'PILOTO', 'America/Mexico_City'],
  );
  const alameda = await client.query(
    `INSERT INTO branches (company_id, name, code, address, timezone)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address
     RETURNING id`,
    [companyId, 'Sucursal Alameda', 'ALAMEDA', 'Calle Alameda 456, Col. Centro', 'America/Mexico_City'],
  );
  const branches = [
    { id: branch.rows[0].id, ...branch.rows[0] },
    { id: alameda.rows[0].id, ...alameda.rows[0] },
  ];
  const role = await client.query(
    `INSERT INTO roles (company_id, name, description) VALUES ($1, $2, $3)
     ON CONFLICT (company_id, name) DO UPDATE SET description = EXCLUDED.description
     RETURNING id`,
    [companyId, 'Administrador', 'Administrador de demostracion'],
  );
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions
     ON CONFLICT DO NOTHING`,
    [role.rows[0].id],
  );
  const user = await client.query(
    `INSERT INTO users (company_id, email, display_name, password_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (company_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id`,
    [companyId, 'admin@demo.local', 'Administrador de demostracion', await bcrypt.hash(password, 12)],
  );
  await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.rows[0].id, role.rows[0].id]);
  await client.query('INSERT INTO user_branches (user_id, branch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.rows[0].id, branch.rows[0].id]);
  await client.query('INSERT INTO user_branches (user_id, branch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.rows[0].id, alameda.rows[0].id]);
  for (const row of branches) {
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      await client.query(
        `INSERT INTO branch_business_hours (branch_id, day_of_week, time_from, time_to)
         VALUES ($1, $2, '07:00', '22:00')
         ON CONFLICT (branch_id, day_of_week) DO UPDATE SET time_from = EXCLUDED.time_from, time_to = EXCLUDED.time_to`,
        [row.id, day],
      );
    }
  }
  await client.query(
    `INSERT INTO cash_registers (company_id, branch_id, name)
     VALUES ($1, $2, 'Caja principal')
     ON CONFLICT (branch_id, name) DO UPDATE SET is_active = true`,
    [companyId, alameda.rows[0].id],
  );
  await client.query(
    `UPDATE sessions SET revoked_at = now()
     WHERE user_id IN (SELECT id FROM users WHERE email = $1 AND id <> $2) AND revoked_at IS NULL`,
    ['admin@demo.local', user.rows[0].id],
  );

  const category = await client.query(
    `INSERT INTO categories (company_id, name, description, sort_order)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (company_id, name) DO UPDATE
       SET description = EXCLUDED.description, sort_order = EXCLUDED.sort_order, is_active = true
     RETURNING id`,
    [companyId, 'Gorditas', 'Categoria de demostracion', 1],
  );

  const demoProducts = [
    {
      sku: 'DEMO-GORDITA-CHICHARRON',
      name: 'Gordita de chicharron',
      description: 'Producto de demostracion',
      variants: [['Sencilla', 32], ['Especial', 42]],
    },
    {
      sku: 'DEMO-GORDITA-PRENSA',
      name: 'Gordita de prensa',
      description: 'Producto de demostracion',
      variants: [['Sencilla', 30], ['Especial', 40]],
    },
    {
      sku: 'DEMO-GORDITA-FRIJOL',
      name: 'Gordita de frijol',
      description: 'Producto de demostracion',
      variants: [['Sencilla', 28], ['Especial', 38]],
    },
  ] as const;

  for (const demoProduct of demoProducts) {
    const product = await client.query(
      `INSERT INTO products (company_id, category_id, name, description, sku)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (company_id, sku) DO UPDATE
         SET category_id = EXCLUDED.category_id, name = EXCLUDED.name,
             description = EXCLUDED.description, is_active = true
       RETURNING id`,
      [companyId, category.rows[0].id, demoProduct.name, demoProduct.description, demoProduct.sku],
    );

    for (const [index, [variantName, price]] of demoProduct.variants.entries()) {
      const variant = await client.query(
        `INSERT INTO product_variants (product_id, name, price, is_default)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id, name) DO UPDATE
           SET price = EXCLUDED.price, is_default = EXCLUDED.is_default, is_active = true
         RETURNING id`,
        [product.rows[0].id, variantName, price, index === 0],
      );
      await client.query(
        `INSERT INTO product_prices (variant_id, price)
         VALUES ($1, $2)
         ON CONFLICT (variant_id) WHERE valid_to IS NULL DO UPDATE SET price = EXCLUDED.price`,
        [variant.rows[0].id, price],
      );
    }

    await client.query(
      `INSERT INTO branch_product_availability (branch_id, product_id, is_available, updated_by)
       VALUES ($1, $2, true, $3)
       ON CONFLICT (branch_id, product_id) DO UPDATE
         SET is_available = true, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [branch.rows[0].id, product.rows[0].id, user.rows[0].id],
    );
    await client.query(
      `INSERT INTO branch_product_availability (branch_id, product_id, is_available, updated_by)
       VALUES ($1, $2, true, $3)
       ON CONFLICT (branch_id, product_id) DO UPDATE
         SET is_available = true, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [alameda.rows[0].id, product.rows[0].id, user.rows[0].id],
    );
    await client.query(
      `INSERT INTO branch_product_hours (branch_id, product_id, day_of_week, time_from, time_to)
       SELECT $1, $2, day, '08:00', '14:00' FROM generate_series(0, 6) AS day
       WHERE $3 = 'DEMO-GORDITA-FRIJOL'
       ON CONFLICT DO NOTHING`,
      [alameda.rows[0].id, product.rows[0].id, demoProduct.sku],
    );
  }

  for (const row of branches) {
    for (const [name, capacity] of [['Mesa 1', 2], ['Mesa 2', 2], ['Mesa 3', 4], ['Mesa 4', 6]] as const) {
      await client.query(
        `INSERT INTO restaurant_tables (company_id, branch_id, name, capacity, status)
         VALUES ($1, $2, $3, $4, 'AVAILABLE')
         ON CONFLICT (branch_id, name) DO UPDATE
           SET company_id = EXCLUDED.company_id, capacity = EXCLUDED.capacity, status = 'AVAILABLE'`,
        [companyId, row.id, name, capacity],
      );
    }
  }

  await client.query(
    `INSERT INTO cash_registers (company_id, branch_id, name)
     VALUES ($1, $2, 'Caja principal')
     ON CONFLICT (branch_id, name) DO UPDATE SET is_active = true`,
    [companyId, branch.rows[0].id],
  );
  await client.query(
    `INSERT INTO payment_method_configs (company_id, method)
     VALUES ($1, 'CASH'), ($1, 'CARD'), ($1, 'TRANSFER')
     ON CONFLICT (company_id, method) DO UPDATE SET is_active = true`,
    [companyId],
  );

  const unitKg = await client.query(`SELECT id FROM units WHERE code='KG' LIMIT 1`);
  const unitKgId = unitKg.rows[0].id;
  const warehouse = await client.query(
    `INSERT INTO warehouses (company_id, branch_id, name)
     VALUES ($1, $2, 'Almacen principal')
     ON CONFLICT (branch_id, name) DO UPDATE SET is_active = true
     RETURNING id`,
    [companyId, branch.rows[0].id],
  );
  const warehouseId = warehouse.rows[0].id;

  const demoIngredients = [
    ['Masa de maiz', 'DEMO-MASA', 25],
    ['Chicharron de cerdo', 'DEMO-CHICHARRON', 10],
    ['Salsa verde', 'DEMO-SALSA', 8],
    ['Queso panela', 'DEMO-QUESO', 12],
  ] as const;

  for (const [name, sku, quantity] of demoIngredients) {
    const ingredient = await client.query(
      `INSERT INTO ingredients (company_id, name, sku, base_unit_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, name) DO UPDATE
         SET sku = EXCLUDED.sku, is_active = true
       RETURNING id`,
      [companyId, name, sku, unitKgId],
    );
    const ingredientId = ingredient.rows[0].id;
    await client.query(
      `INSERT INTO stock_balances (company_id, branch_id, warehouse_id, ingredient_id, quantity)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (warehouse_id, ingredient_id) DO UPDATE
         SET quantity = EXCLUDED.quantity, updated_at = now()`,
      [companyId, branch.rows[0].id, warehouseId, ingredientId, quantity],
    );
    await client.query(
      `INSERT INTO stock_movements (company_id, branch_id, warehouse_id, ingredient_id, movement_type, quantity, unit_id, reason, created_by)
       SELECT $1, $2, $3, $4, 'PURCHASE', $5, $6, 'Inventario inicial (seed)', $7
       WHERE NOT EXISTS (
         SELECT 1 FROM stock_movements sm
         WHERE sm.company_id = $1 AND sm.ingredient_id = $4 AND sm.movement_type = 'PURCHASE' AND sm.reason = 'Inventario inicial (seed)'
       )`,
      [companyId, branch.rows[0].id, warehouseId, ingredientId, quantity, unitKgId, user.rows[0].id],
    );
  }

  const recipe = await client.query(
    `INSERT INTO recipes (company_id, branch_id, product_id, name)
     SELECT $1, $2, (SELECT id FROM products WHERE company_id = $1 AND sku = 'DEMO-GORDITA-CHICHARRON'), 'Gordita de chicharron'
     ON CONFLICT (company_id, name) DO NOTHING
     RETURNING id`,
    [companyId, branch.rows[0].id],
  );
  if (recipe.rowCount === 1) {
    const recipeId = recipe.rows[0].id;
    const version = await client.query(
      `INSERT INTO recipe_versions (recipe_id, version, notes, created_by)
       VALUES ($1, 1, 'Version inicial de demostracion', $2)
       ON CONFLICT (recipe_id, version) DO NOTHING
       RETURNING id`,
      [recipeId, user.rows[0].id],
    );
    if (version.rowCount === 1) {
      const versionId = version.rows[0].id;
      const recipeItems = [
        ['Masa de maiz', 0.1],
        ['Chicharron de cerdo', 0.15],
        ['Salsa verde', 0.05],
        ['Queso panela', 0.02],
      ] as const;
      for (const [ingredientName, quantity] of recipeItems) {
        await client.query(
          `INSERT INTO recipe_items (recipe_version_id, ingredient_id, quantity, unit_id)
           SELECT $1, id, $2, $3 FROM ingredients WHERE company_id = $4 AND name = $5`,
          [versionId, quantity, unitKgId, companyId, ingredientName],
        );
      }
    }
  }

  await client.query(
    `INSERT INTO suppliers (company_id, name, tax_id, contact_name, phone, email)
     VALUES ($1, 'Proveedor de demostracion', 'DOG920101AA1', 'Juan Demo', '555-0100', 'ventas@proveedor-demo.mx')
     ON CONFLICT (company_id, name) DO NOTHING`,
    [companyId],
  );

  const demoCustomer = await client.query(
    `INSERT INTO customers (company_id, name, phone)
     VALUES ($1, 'Lupita Lopez', '5512345678')
     ON CONFLICT (company_id, phone) DO UPDATE SET name = EXCLUDED.name, is_active = true
     RETURNING id`,
    [companyId],
  );
  await client.query(
    `INSERT INTO customer_addresses (customer_id, label, street, neighborhood, city, reference)
     VALUES ($1, 'Casa', 'Av. Juarez 123', 'Centro', 'Ciudad de demostracion', 'Porton azul')
     ON CONFLICT (customer_id, label) DO UPDATE
       SET street = EXCLUDED.street, neighborhood = EXCLUDED.neighborhood,
           city = EXCLUDED.city, reference = EXCLUDED.reference`,
    [demoCustomer.rows[0].id],
  );
  await client.query(
    `INSERT INTO delivery_zones (company_id, name, fee)
     VALUES ($1, 'Centro', 25)
     ON CONFLICT (company_id, name) DO UPDATE SET fee = EXCLUDED.fee, is_active = true`,
    [companyId],
  );
  await client.query(
    `INSERT INTO couriers (company_id, name, phone, type)
     SELECT $1, 'Maria · Repartidora demo', '555-0199', 'INTERNAL'
     WHERE NOT EXISTS (SELECT 1 FROM couriers WHERE company_id = $1 AND name = 'Maria · Repartidora demo')`,
    [companyId],
  );

  await client.query('COMMIT');
  console.log('Seed completado: admin@demo.local, catalogo demo, mesas, inventario, clientes y configuracion basica');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
