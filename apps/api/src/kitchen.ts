import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import { requireUser, userHasPermission } from './auth.js';
import { publishKitchenEvent, subscribeKitchenEvents, type KitchenEvent } from './kitchen-events.js';

type User = { id: string; company_id: string };
const uuid = z.string().uuid();

function currentUser(request: FastifyRequest): User {
  return request.user as User;
}

async function allowedBranch(request: FastifyRequest, branchId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM branches b JOIN user_branches ub ON ub.branch_id = b.id
     WHERE b.id = $1 AND b.company_id = $2 AND b.is_active AND ub.user_id = $3`,
    [branchId, currentUser(request).company_id, currentUser(request).id],
  );
  return result.rowCount === 1;
}

async function permission(request: FastifyRequest, reply: FastifyReply, code: string): Promise<boolean> {
  if (!(await userHasPermission(currentUser(request).id, code))) {
    await reply.code(403).send({ error: 'Permiso insuficiente' });
    return false;
  }
  return true;
}

async function details(orderId: string, companyId: string) {
  const order = await pool.query(
    `SELECT id, branch_id, folio, status, kitchen_status, channel, notes, total, created_at,
            kitchen_started_at, kitchen_ready_at
     FROM orders WHERE id = $1 AND company_id = $2`,
    [orderId, companyId],
  );
  if (!order.rowCount) return null;
  const items = await pool.query(
    `SELECT oi.id, oi.product_name, oi.variant_name, oi.quantity, oi.notes, oi.unit_price,
            COALESCE(json_agg(json_build_object('id', oim.id, 'name', oim.name, 'priceDelta', oim.price_delta))
              FILTER (WHERE oim.id IS NOT NULL), '[]') modifiers
     FROM order_items oi LEFT JOIN order_item_modifiers oim ON oim.order_item_id = oi.id
     WHERE oi.order_id = $1 GROUP BY oi.id ORDER BY oi.created_at`,
    [orderId],
  );
  return { ...order.rows[0], items: items.rows };
}

function makeEvent(order: { id: string; branch_id: string; kitchen_status: string }, type: KitchenEvent['type']): KitchenEvent {
  return {
    id: crypto.randomUUID(), type, branchId: order.branch_id, orderId: order.id,
    status: order.kitchen_status, occurredAt: new Date().toISOString(),
  };
}

export async function registerKitchenRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/branches/:branchId/kitchen/orders', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'kitchen.read'))) return;
    const branchId = (request.params as { branchId: string }).branchId;
    if (!uuid.safeParse(branchId).success || !(await allowedBranch(request, branchId))) return reply.code(403).send({ error: 'Sucursal no autorizada' });
    const result = await pool.query(
      `SELECT id, folio, status, kitchen_status, channel, notes, total, created_at, kitchen_started_at, kitchen_ready_at
       FROM orders WHERE company_id = $1 AND branch_id = $2 AND kitchen_status IN ('PENDING', 'IN_PROGRESS')
       ORDER BY created_at`,
      [currentUser(request).company_id, branchId],
    );
    return { data: result.rows };
  });

  app.get('/api/v1/branches/:branchId/kitchen/events', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'kitchen.read'))) return;
    const branchId = (request.params as { branchId: string }).branchId;
    if (!uuid.safeParse(branchId).success || !(await allowedBranch(request, branchId))) return reply.code(403).send({ error: 'Sucursal no autorizada' });
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    reply.raw.write(': conectado\n\n');
    const cleanup = subscribeKitchenEvents(currentUser(request).company_id, branchId, (update) => {
      reply.raw.write(`event: ${update.type}\ndata: ${JSON.stringify(update)}\n\n`);
    });
    await new Promise<void>((resolve) => request.raw.once('close', resolve));
    cleanup();
    if (!reply.raw.destroyed) reply.raw.end();
  });

  app.get('/api/v1/kitchen/orders/:id', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'kitchen.read'))) return;
    const order = await details((request.params as { id: string }).id, currentUser(request).company_id);
    if (!order || !(await allowedBranch(request, order.branch_id))) return reply.code(404).send({ error: 'Comanda no encontrada' });
    return { data: order };
  });

  app.post('/api/v1/kitchen/orders/:id/start', { preHandler: requireUser }, async (request, reply) => updateKitchenStatus(request, reply, 'IN_PROGRESS'));
  app.post('/api/v1/kitchen/orders/:id/ready', { preHandler: requireUser }, async (request, reply) => updateKitchenStatus(request, reply, 'READY'));
}

async function updateKitchenStatus(request: FastifyRequest, reply: FastifyReply, target: 'IN_PROGRESS' | 'READY') {
  if (!(await permission(request, reply, 'kitchen.manage'))) return;
  const input = z.object({ idempotencyKey: z.string().trim().min(8).max(120) }).safeParse(request.body);
  if (!input.success) return reply.code(400).send({ error: 'Clave de idempotencia invalida' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM orders WHERE id = $1 AND company_id = $2 FOR UPDATE', [(request.params as { id: string }).id, currentUser(request).company_id]);
    if (result.rowCount !== 1 || !(await allowedBranch(request, result.rows[0].branch_id))) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Comanda no encontrada' }); }
    const order = result.rows[0];
    const prior = await client.query('SELECT id FROM order_events WHERE order_id = $1 AND event_type = $2 AND idempotency_key = $3', [order.id, `KITCHEN_${target}`, input.data.idempotencyKey]);
    if (prior.rowCount) { await client.query('ROLLBACK'); return { data: order, idempotent: true }; }
    const valid = (target === 'IN_PROGRESS' && order.kitchen_status === 'PENDING') || (target === 'READY' && order.kitchen_status === 'IN_PROGRESS');
    if (!valid) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Transicion de cocina invalida' }); }
    const updated = await client.query(
      `UPDATE orders SET kitchen_status = $1,
       kitchen_started_at = CASE WHEN $1 = 'IN_PROGRESS' THEN now() ELSE kitchen_started_at END,
       kitchen_started_by = CASE WHEN $1 = 'IN_PROGRESS' THEN $2 ELSE kitchen_started_by END,
       kitchen_ready_at = CASE WHEN $1 = 'READY' THEN now() ELSE kitchen_ready_at END,
       kitchen_ready_by = CASE WHEN $1 = 'READY' THEN $2 ELSE kitchen_ready_by END,
       updated_at = now() WHERE id = $3 RETURNING *`,
      [target, currentUser(request).id, order.id],
    );
    await client.query('INSERT INTO order_events (order_id,event_type,from_status,to_status,actor_id,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6)', [order.id, `KITCHEN_${target}`, order.kitchen_status, target, currentUser(request).id, input.data.idempotencyKey]);
    await client.query('COMMIT');
    publishKitchenEvent(currentUser(request).company_id, makeEvent(updated.rows[0], 'order.kitchen_status_changed'));
    return { data: updated.rows[0], idempotent: false };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}