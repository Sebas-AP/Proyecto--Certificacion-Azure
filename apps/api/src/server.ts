import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';
import { createSession, requireUser, sessionCookieOptions, userHasPermission, verifyPassword } from './auth.js';
import { registerCatalogOrderRoutes } from './catalog-orders.js';

const app = Fastify({ logger: true });
await app.register(cookie);
await app.register(cors, { origin: config.CORS_ORIGIN, credentials: true });

app.get('/health', async () => ({ status: 'ok', service: 'gorditasos-api' }));

app.post('/api/v1/auth/login', async (request, reply) => {
  const input = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(request.body);
  if (!input.success) return reply.code(400).send({ error: 'Datos de acceso invalidos' });

  const result = await pool.query(
    `SELECT id, password_hash, is_active FROM users WHERE lower(email) = lower($1) LIMIT 1`,
    [input.data.email],
  );
  const user = result.rows[0];
  if (!user || !user.is_active || !(await verifyPassword(input.data.password, user.password_hash))) {
    return reply.code(401).send({ error: 'Credenciales invalidas' });
  }

  const token = await createSession(user.id);
  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  return reply.setCookie('session', token, sessionCookieOptions).send({ authenticated: true });
});

app.post('/api/v1/auth/logout', { preHandler: requireUser }, async (request, reply) => {
  const token = request.cookies.session;
  await pool.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = encode(digest($1, \'sha256\'), \'hex\')', [token]);
  return reply.clearCookie('session', { path: '/' }).send({ authenticated: false });
});

app.get('/api/v1/auth/me', { preHandler: requireUser }, async (request) => ({ user: request.user }));

app.get('/api/v1/branches', { preHandler: requireUser }, async (request, reply) => {
  if (!(await userHasPermission(request.user!.id, 'branch.read'))) {
    return reply.code(403).send({ error: 'Permiso insuficiente' });
  }
  const result = await pool.query(
    `SELECT id, name, code, address, timezone, is_active
     FROM branches WHERE company_id = $1 ORDER BY name`,
    [request.user!.company_id],
  );
  return { data: result.rows };
});

app.post('/api/v1/shifts/open', { preHandler: requireUser }, async (request, reply) => {
  if (!(await userHasPermission(request.user!.id, 'shift.open'))) {
    return reply.code(403).send({ error: 'Permiso insuficiente' });
  }
  const input = z.object({ branchId: z.string().uuid(), openingNote: z.string().max(500).optional() }).safeParse(request.body);
  if (!input.success) return reply.code(400).send({ error: 'Sucursal o nota invalida' });

  const branch = await pool.query(
    `SELECT id FROM branches b JOIN user_branches ub ON ub.branch_id = b.id
     WHERE b.id = $1 AND b.company_id = $2 AND b.is_active = true AND ub.user_id = $3`,
    [input.data.branchId, request.user!.company_id, request.user!.id],
  );
  if (branch.rowCount !== 1) return reply.code(403).send({ error: 'Sucursal no autorizada' });

  try {
    const result = await pool.query(
      `INSERT INTO shifts (company_id, branch_id, opened_by, opening_note)
       VALUES ($1, $2, $3, $4)
       RETURNING id, branch_id, status, opened_at, opening_note`,
      [request.user!.company_id, input.data.branchId, request.user!.id, input.data.openingNote ?? null],
    );
    return reply.code(201).send({ data: result.rows[0] });
  } catch (error) {
    if (error instanceof Error && 'constraint' in error && (error as { constraint?: string }).constraint === 'one_open_shift_per_user_branch') {
      return reply.code(409).send({ error: 'Ya existe un turno abierto para esta sucursal' });
    }
    throw error;
  }
});

app.post('/api/v1/shifts/:id/close', { preHandler: requireUser }, async (request, reply) => {
  if (!(await userHasPermission(request.user!.id, 'shift.close'))) {
    return reply.code(403).send({ error: 'Permiso insuficiente' });
  }
  const input = z.object({ closingNote: z.string().max(500).optional() }).safeParse(request.body);
  if (!input.success) return reply.code(400).send({ error: 'Nota invalida' });
  const result = await pool.query(
    `UPDATE shifts SET status = 'CLOSED', closed_at = now(), closed_by = $1, closing_note = $2
     WHERE id = $3 AND company_id = $4 AND status = 'OPEN'
     RETURNING id, branch_id, status, opened_at, closed_at, closing_note`,
    [request.user!.id, input.data.closingNote ?? null, request.params && (request.params as { id: string }).id, request.user!.company_id],
  );
  if (result.rowCount !== 1) return reply.code(404).send({ error: 'Turno abierto no encontrado' });
  return { data: result.rows[0] };
});

await registerCatalogOrderRoutes(app);

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  return reply.code(500).send({ error: 'Error interno del servidor' });
});

const close = async () => {
  await app.close();
  await pool.end();
};
process.once('SIGINT', close);
process.once('SIGTERM', close);

await app.listen({ port: config.PORT, host: '0.0.0.0' });
