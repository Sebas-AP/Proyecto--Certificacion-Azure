import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import { requireUser, userHasPermission } from './auth.js';
import { branchOpenNow } from './scheduling.js';

type User = { id: string; company_id: string };

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'] as const;

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora en formato HH:MM');

export function defaultWindowRows(windows: { day_of_week: number; time_from: string; time_to: string }[]): { day: number; from: string; to: string; name: string }[] {
  const byDay = new Map<number, { time_from: string; time_to: string }[]>();
  for (const window of windows) {
    const list = byDay.get(window.day_of_week) ?? [];
    list.push({ time_from: window.time_from, time_to: window.time_to });
    byDay.set(window.day_of_week, list);
  }
  return DAY_NAMES.map((name, day) => {
    const windowsDay = byDay.get(day);
    if (!windowsDay || windowsDay.length === 0) return { day, name, from: '', to: '' };
    if (windowsDay.length === 1) return { day, name, from: windowsDay[0].time_from, to: windowsDay[0].time_to };
    return { day, name, from: '', to: `(ventanas: ${windowsDay.map(w => `${w.time_from}-${w.time_to}`).join(', ')})` };
  });
}

async function branchOwned(request: FastifyRequest, reply: FastifyReply, branchId: string): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM branches b JOIN user_branches ub ON ub.branch_id = b.id WHERE b.id = $1 AND b.company_id = $2 AND ub.user_id = $3`, [branchId, (request.user as User).company_id, (request.user as User).id]);
  if (result.rowCount === 1) return true;
  await reply.code(403).send({ error: 'Sucursal no autorizada' });
  return false;
}

async function permission(request: FastifyRequest, reply: FastifyReply, code: string): Promise<boolean> {
  if (await userHasPermission((request.user as User).id, code)) return true;
  await reply.code(403).send({ error: 'Permiso insuficiente' });
  return false;
}

export async function registerBranchRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/branches', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'branch.manage'))) return;
    const input = z.object({ name: z.string().trim().min(1).max(160), code: z.string().trim().min(1).max(40), address: z.string().max(300).optional(), timezone: z.string().trim().min(1).max(80).default('America/Mexico_City') }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Datos de sucursal invalidos' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const branch = await client.query('INSERT INTO branches (company_id, name, code, address, timezone) VALUES ($1,$2,$3,$4,$5) RETURNING *', [(request.user as User).company_id, input.data.name, input.data.code, input.data.address ?? null, input.data.timezone]);
      await client.query('INSERT INTO audit_logs (company_id, actor_id, entity_type, entity_id, action, new_values) VALUES ($1,$2,\'branch\',$3,\'branch.created\',$4)', [(request.user as User).company_id, (request.user as User).id, branch.rows[0].id, JSON.stringify({ name: input.data.name, code: input.data.code } )]);
      await client.query('COMMIT');
      return reply.code(201).send({ data: branch.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'El codigo de sucursal ya existe' });
      throw error;
    } finally { client.release(); }
  });

  app.patch('/api/v1/branches/:id', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'branch.manage'))) return;
    const input = z.object({ name: z.string().trim().min(1).max(160).optional(), code: z.string().trim().min(1).max(40).optional(), address: z.string().max(300).nullable().optional(), timezone: z.string().trim().min(1).max(80).optional(), isActive: z.boolean().optional() }).safeParse(request.body);
    const id = (request.params as { id: string }).id;
    if (!input.success) return reply.code(400).send({ error: 'Datos de sucursal invalidos' });
    if (!(await branchOwned(request, reply, id))) return;
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of [['name', 'name'], ['code', 'code'], ['address', 'address'], ['timezone', 'timezone'], ['isActive', 'is_active']] as const) {
      if (input.data[key] !== undefined) { values.push(input.data[key]); fields.push(`${column} = $${values.length}`); }
    }
    if (!fields.length) return reply.code(400).send({ error: 'Sin cambios' });
    values.push(id);
    try {
      const result = await pool.query(`UPDATE branches SET ${fields.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`, values);
      return { data: result.rows[0] };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'El codigo de sucursal ya existe' });
      throw error;
    }
  });

  app.get('/api/v1/branches/:branchId/hours', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'branch.read'))) return;
    const branchId = (request.params as { branchId: string }).branchId;
    if (!(await branchOwned(request, reply, branchId))) return;
    const { openNow, timezone, hours } = await branchOpenNow(branchId);
    return { data: { timezone, openNow, hours } };
  });

  app.put('/api/v1/branches/:branchId/hours', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'schedule.manage'))) return;
    const branchId = (request.params as { branchId: string }).branchId;
    if (!(await branchOwned(request, reply, branchId))) return;
    const input = z.object({ hours: z.array(z.object({ day: z.number().int().min(0).max(6), from: timeSchema, to: timeSchema })).max(7) }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Horario invalido' });
    const seen = new Set<number>();
    for (const row of input.data.hours) {
      if (seen.has(row.day)) return reply.code(400).send({ error: 'Dia duplicado' });
      seen.add(row.day);
      if (row.from >= row.to) return reply.code(400).send({ error: 'La hora de apertura debe ser anterior al cierre' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM branch_business_hours WHERE branch_id = $1', [branchId]);
      for (const row of input.data.hours) {
        await client.query('INSERT INTO branch_business_hours (branch_id, day_of_week, time_from, time_to) VALUES ($1,$2,$3,$4)', [branchId, row.day, row.from, row.to]);
      }
      await client.query('INSERT INTO audit_logs (company_id, branch_id, actor_id, entity_type, entity_id, action, new_values) VALUES ($1,$2,$3,\'branch\',$2,\'hours.changed\',$4)', [(request.user as User).company_id, branchId, (request.user as User).id, JSON.stringify(input.data.hours)]);
      await client.query('COMMIT');
      const { openNow, hours } = await branchOpenNow(branchId);
      return { data: { hours, openNow } };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });

  app.get('/api/v1/branches/:branchId/products/:productId/hours', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'catalog.read'))) return;
    const { branchId, productId } = request.params as { branchId: string; productId: string };
    if (!(await branchOwned(request, reply, branchId))) return;
    const product = await pool.query('SELECT 1 FROM products WHERE id = $1 AND company_id = $2', [productId, (request.user as User).company_id]);
    if (!product.rowCount) return reply.code(404).send({ error: 'Producto no encontrado' });
    const windows = await pool.query('SELECT day_of_week, time_from::text, time_to::text FROM branch_product_hours WHERE branch_id = $1 AND product_id = $2 ORDER BY day_of_week, time_from', [branchId, productId]);
    return { data: windows.rows };
  });

  app.put('/api/v1/branches/:branchId/products/:productId/hours', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'schedule.manage'))) return;
    const { branchId, productId } = request.params as { branchId: string; productId: string };
    if (!(await branchOwned(request, reply, branchId))) return;
    const input = z.object({ windows: z.array(z.object({ day: z.number().int().min(0).max(6), from: timeSchema, to: timeSchema })).max(21) }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Ventanas invalidas' });
    for (const row of input.data.windows) {
      if (row.from >= row.to) return reply.code(400).send({ error: 'El horario de la ventana es invalido' });
    }
    const product = await pool.query('SELECT 1 FROM products WHERE id = $1 AND company_id = $2', [productId, (request.user as User).company_id]);
    if (!product.rowCount) return reply.code(404).send({ error: 'Producto no encontrado' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM branch_product_hours WHERE branch_id = $1 AND product_id = $2', [branchId, productId]);
      for (const row of input.data.windows) {
        await client.query('INSERT INTO branch_product_hours (branch_id, product_id, day_of_week, time_from, time_to) VALUES ($1,$2,$3,$4,$5)', [branchId, productId, row.day, row.from, row.to]);
      }
      await client.query('INSERT INTO audit_logs (company_id, branch_id, actor_id, entity_type, entity_id, action, new_values) VALUES ($1,$2,$3,\'product\',$4,\'hours.changed\',$5)', [(request.user as User).company_id, branchId, (request.user as User).id, productId, JSON.stringify(input.data.windows)]);
      await client.query('COMMIT');
      return { data: input.data.windows };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });
}