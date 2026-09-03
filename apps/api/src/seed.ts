import bcrypt from 'bcryptjs';
import { pool } from './db.js';

const password = process.env.SEED_ADMIN_PASSWORD;
if (!password || password.length < 12) {
  throw new Error('SEED_ADMIN_PASSWORD debe tener al menos 12 caracteres');
}

const client = await pool.connect();
try {
  await client.query('BEGIN');
  const company = await client.query(
    `INSERT INTO companies (name) VALUES ($1)
     ON CONFLICT DO NOTHING RETURNING id`,
    ['Empresa de demostracion'],
  );
  const companyId = company.rows[0]?.id ?? (await client.query('SELECT id FROM companies ORDER BY created_at LIMIT 1')).rows[0].id;
  const branch = await client.query(
    `INSERT INTO branches (company_id, name, code, timezone)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [companyId, 'Sucursal piloto', 'PILOTO', 'America/Mexico_City'],
  );
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
  await client.query('COMMIT');
  console.log('Seed completado para admin@demo.local');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
