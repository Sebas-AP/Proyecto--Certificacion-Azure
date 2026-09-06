import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireUser, userHasPermission } from './auth.js';
import { calculateChange, calculateExpectedCash, canCompleteOrder, money } from './cash-domain.js';
import { pool } from './db.js';

type User = { id: string; company_id: string };
const uuid = z.string().uuid();
const amount = z.number().positive().multipleOf(0.01);
const methods = z.enum(['CASH', 'CARD', 'TRANSFER']);

function user(request: FastifyRequest): User { return request.user as User; }
function params(request: FastifyRequest): Record<string, string> { return request.params as Record<string, string>; }

async function permission(request: FastifyRequest, reply: FastifyReply, code: string): Promise<boolean> {
  if (!(await userHasPermission(user(request).id, code))) {
    await reply.code(403).send({ error: 'Permiso insuficiente' });
    return false;
  }
  return true;
}

async function allowedBranch(request: FastifyRequest, branchId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM branches b JOIN user_branches ub ON ub.branch_id = b.id
     WHERE b.id = $1 AND b.company_id = $2 AND b.is_active AND ub.user_id = $3`,
    [branchId, user(request).company_id, user(request).id],
  );
  return result.rowCount === 1;
}

async function audit(client: { query: (text: string, values?: unknown[]) => Promise<unknown> }, values: unknown[]): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (company_id, branch_id, actor_id, entity_type, entity_id, action, previous_values, new_values, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, values,
  );
}

export async function registerCashPaymentRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/branches/:branchId/cash-sessions/open', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'cash.open'))) return;
    const input = z.object({ openingCash: amount, cashRegisterId: uuid.optional() }).safeParse(request.body);
    const branchId = params(request).branchId;
    if (!input.success || !uuid.safeParse(branchId).success || !(await allowedBranch(request, branchId))) {
      return reply.code(400).send({ error: 'Datos de apertura invalidos' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const register = await client.query(
        `INSERT INTO cash_registers (company_id, branch_id, name)
         SELECT $1, $2, 'Caja principal'
         WHERE $3::uuid IS NULL
         ON CONFLICT (branch_id, name) DO UPDATE SET is_active = true
         RETURNING id`,
        [user(request).company_id, branchId, input.data.cashRegisterId ?? null],
      );
      const registerId = input.data.cashRegisterId ?? register.rows[0]?.id;
      const validRegister = await client.query(
        `SELECT id FROM cash_registers WHERE id = $1 AND company_id = $2 AND branch_id = $3 AND is_active FOR UPDATE`,
        [registerId, user(request).company_id, branchId],
      );
      if (validRegister.rowCount !== 1) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Caja no pertenece a la sucursal' });
      }
      const result = await client.query(
        `INSERT INTO cash_sessions (company_id, branch_id, cash_register_id, opened_by, opening_cash)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [user(request).company_id, branchId, registerId, user(request).id, input.data.openingCash],
      );
      await audit(client, [user(request).company_id, branchId, user(request).id, 'cash_session', result.rows[0].id, 'cash.opened', null, JSON.stringify(result.rows[0]), null]);
      await client.query('COMMIT');
      return reply.code(201).send({ data: result.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'Ya existe una caja abierta en la sucursal' });
      throw error;
    } finally { client.release(); }
  });

  app.get('/api/v1/branches/:branchId/cash-sessions/current', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'cash.read'))) return;
    const branchId = params(request).branchId;
    if (!uuid.safeParse(branchId).success || !(await allowedBranch(request, branchId))) return reply.code(403).send({ error: 'Sucursal no autorizada' });
    const result = await pool.query(
      `SELECT * FROM cash_sessions WHERE company_id=$1 AND branch_id=$2 AND status='OPEN'`,
      [user(request).company_id, branchId],
    );
    return { data: result.rows[0] ?? null };
  });

  app.post('/api/v1/cash-sessions/:id/movements', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'cash.move'))) return;
    const input = z.object({ movementType: z.enum(['IN', 'OUT']), amount, reason: z.string().trim().min(1).max(500) }).safeParse(request.body);
    if (!input.success || !uuid.safeParse(params(request).id).success) return reply.code(400).send({ error: 'Movimiento invalido' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const session = await client.query(
        `SELECT id, branch_id FROM cash_sessions WHERE id=$1 AND company_id=$2 AND status='OPEN' FOR UPDATE`,
        [params(request).id, user(request).company_id],
      );
      if (session.rowCount !== 1 || !(await allowedBranch(request, session.rows[0].branch_id))) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Sesion de caja abierta no encontrada' });
      }
      const result = await client.query(
        `INSERT INTO cash_movements (company_id, branch_id, cash_session_id, created_by, movement_type, amount, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [user(request).company_id, session.rows[0].branch_id, params(request).id, user(request).id, input.data.movementType, input.data.amount, input.data.reason],
      );
      await audit(client, [user(request).company_id, session.rows[0].branch_id, user(request).id, 'cash_movement', result.rows[0].id, 'cash.movement.created', null, JSON.stringify(result.rows[0]), input.data.reason]);
      await client.query('COMMIT');
      return reply.code(201).send({ data: result.rows[0] });
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });

  app.post('/api/v1/orders/:id/payments', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'payment.create'))) return;
    const input = z.object({ method: methods, amount, cashReceived: amount.optional(), idempotencyKey: z.string().trim().min(8).max(120) }).safeParse(request.body);
    if (!input.success || !uuid.safeParse(params(request).id).success) return reply.code(400).send({ error: 'Pago invalido' });
    if (input.data.method === 'CASH' && input.data.cashReceived === undefined) return reply.code(400).send({ error: 'El efectivo recibido es requerido' });
    if (input.data.method !== 'CASH' && input.data.cashReceived !== undefined) return reply.code(400).send({ error: 'El efectivo recibido solo aplica a pagos en efectivo' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const orderResult = await client.query(`SELECT * FROM orders WHERE id=$1 AND company_id=$2 FOR UPDATE`, [params(request).id, user(request).company_id]);
      if (orderResult.rowCount !== 1) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Pedido no encontrado' }); }
      const order = orderResult.rows[0];
      const prior = await client.query(`SELECT * FROM payments WHERE order_id=$1 AND idempotency_key=$2`, [order.id, input.data.idempotencyKey]);
      if (prior.rowCount) { await client.query('ROLLBACK'); return { data: prior.rows[0], idempotent: true }; }
      if (['CANCELLED', 'COMPLETED'].includes(order.status)) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'El pedido no admite pagos' }); }
      const configured = await client.query(`SELECT 1 FROM payment_method_configs WHERE company_id=$1 AND method=$2 AND is_active`, [user(request).company_id, input.data.method]);
      if (configured.rowCount !== 1) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Metodo de pago no habilitado' }); }
      const paidResult = await client.query(`SELECT COALESCE(SUM(amount),0) paid FROM payments WHERE order_id=$1`, [order.id]);
      const paid = money(paidResult.rows[0].paid);
      if (paid + input.data.amount > money(order.total)) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'El pago sobrepasa el total del pedido' }); }
      let cashSessionId: string | null = null;
      let changeAmount = 0;
      if (input.data.method === 'CASH') {
        const session = await client.query(`SELECT id, branch_id FROM cash_sessions WHERE company_id=$1 AND branch_id=$2 AND status='OPEN' FOR UPDATE`, [user(request).company_id, order.branch_id]);
        if (session.rowCount !== 1) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'No hay una sesion de caja abierta' }); }
        cashSessionId = session.rows[0].id;
        changeAmount = calculateChange(input.data.amount, input.data.cashReceived!);
      }
      const inserted = await client.query(
        `INSERT INTO payments (company_id,branch_id,order_id,cash_session_id,created_by,method,amount,cash_received,change_amount,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [user(request).company_id, order.branch_id, order.id, cashSessionId, user(request).id, input.data.method, input.data.amount, input.data.cashReceived ?? null, changeAmount, input.data.idempotencyKey],
      );
      const newPaid = paid + input.data.amount;
      let updatedOrder = order;
      if (canCompleteOrder(order.total, newPaid)) {
        updatedOrder = (await client.query(`UPDATE orders SET status='COMPLETED', updated_at=now() WHERE id=$1 RETURNING *`, [order.id])).rows[0];
        await client.query(`INSERT INTO order_events (order_id,event_type,from_status,to_status,actor_id) VALUES ($1,'COMPLETED',$2,'COMPLETED',$3)`, [order.id, order.status, user(request).id]);
        await audit(client, [user(request).company_id, order.branch_id, user(request).id, 'order', order.id, 'status.completed', JSON.stringify({ status: order.status }), JSON.stringify({ status: 'COMPLETED' }), 'Pago liquidado']);
      }
      await audit(client, [user(request).company_id, order.branch_id, user(request).id, 'payment', inserted.rows[0].id, 'payment.created', null, JSON.stringify(inserted.rows[0]), null]);
      await client.query('COMMIT');
      return reply.code(201).send({ data: inserted.rows[0], order: updatedOrder, idempotent: false });
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') {
        const prior = await pool.query(`SELECT * FROM payments WHERE order_id=$1 AND idempotency_key=$2`, [params(request).id, input.data.idempotencyKey]);
        if (prior.rowCount) return { data: prior.rows[0], idempotent: true };
      }
      throw error;
    } finally { client.release(); }
  });

  app.get('/api/v1/orders/:id/payments', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'cash.read'))) return;
    const orderId = params(request).id;
    const order = await pool.query(`SELECT branch_id FROM orders WHERE id=$1 AND company_id=$2`, [orderId, user(request).company_id]);
    if (order.rowCount !== 1 || !(await allowedBranch(request, order.rows[0].branch_id))) return reply.code(404).send({ error: 'Pedido no encontrado' });
    const result = await pool.query(`SELECT p.*, COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.payment_id=p.id AND r.status='APPROVED'),0) refunded_amount FROM payments p WHERE p.order_id=$1 AND p.company_id=$2 ORDER BY p.created_at`, [orderId, user(request).company_id]);
    return { data: result.rows };
  });

  app.post('/api/v1/cash-sessions/:id/close', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'cash.close'))) return;
    const input = z.object({ countedCash: amount, closingNote: z.string().max(500).optional() }).safeParse(request.body);
    if (!input.success || !uuid.safeParse(params(request).id).success) return reply.code(400).send({ error: 'Cierre invalido' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const session = await client.query(`SELECT * FROM cash_sessions WHERE id=$1 AND company_id=$2 AND status='OPEN' FOR UPDATE`, [params(request).id, user(request).company_id]);
      if (session.rowCount !== 1 || !(await allowedBranch(request, session.rows[0].branch_id))) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Sesion de caja abierta no encontrada' }); }
      const sums = await client.query(
        `SELECT COALESCE((SELECT SUM(amount) FROM cash_movements WHERE cash_session_id=$1 AND movement_type='IN'),0) movements_in,
                COALESCE((SELECT SUM(amount) FROM cash_movements WHERE cash_session_id=$1 AND movement_type='OUT'),0) movements_out,
                COALESCE((SELECT SUM(amount) FROM payments WHERE cash_session_id=$1),0) cash_payments,
                COALESCE((SELECT SUM(change_amount) FROM payments WHERE cash_session_id=$1),0) cash_change,
                COALESCE((SELECT SUM(r.amount) FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE p.cash_session_id=$1 AND r.status='APPROVED'),0) refunds`, [params(request).id],
      );
      const row = sums.rows[0];
      const expected = calculateExpectedCash(session.rows[0].opening_cash, row.movements_in, row.movements_out, row.cash_payments, row.cash_change) - money(row.refunds);
      const difference = money(input.data.countedCash) - expected;
      const result = await client.query(`UPDATE cash_sessions SET status='CLOSED',closed_by=$1,closed_at=now(),counted_cash=$2,expected_cash=$3,difference=$4,closing_note=$5 WHERE id=$6 RETURNING *`, [user(request).id, input.data.countedCash, expected, difference, input.data.closingNote ?? null, params(request).id]);
      await audit(client, [user(request).company_id, session.rows[0].branch_id, user(request).id, 'cash_session', params(request).id, 'cash.closed', JSON.stringify({ status: 'OPEN' }), JSON.stringify(result.rows[0]), input.data.closingNote ?? null]);
      await client.query('COMMIT');
      return { data: result.rows[0] };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });

  app.post('/api/v1/payments/:id/refund-request', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'payment.refund.request'))) return;
    const input = z.object({ amount, reason: z.string().trim().min(1).max(500) }).safeParse(request.body);
    if (!input.success || !uuid.safeParse(params(request).id).success) return reply.code(400).send({ error: 'Solicitud de reembolso invalida' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const payment = await client.query(`SELECT * FROM payments WHERE id=$1 AND company_id=$2 FOR UPDATE`, [params(request).id, user(request).company_id]);
      if (payment.rowCount !== 1 || !(await allowedBranch(request, payment.rows[0].branch_id))) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Pago no encontrado' }); }
      const used = await client.query(`SELECT COALESCE(SUM(amount),0) used FROM refunds WHERE payment_id=$1 AND status IN ('REQUESTED','APPROVED')`, [params(request).id]);
      if (money(used.rows[0].used) + input.data.amount > money(payment.rows[0].amount)) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'El reembolso sobrepasa el pago original' }); }
      const result = await client.query(`INSERT INTO refunds (company_id,branch_id,payment_id,requested_by,amount,reason) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [user(request).company_id, payment.rows[0].branch_id, params(request).id, user(request).id, input.data.amount, input.data.reason]);
      await audit(client, [user(request).company_id, payment.rows[0].branch_id, user(request).id, 'refund', result.rows[0].id, 'refund.requested', null, JSON.stringify(result.rows[0]), input.data.reason]);
      await client.query('COMMIT');
      return reply.code(201).send({ data: result.rows[0] });
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });

  app.post('/api/v1/payments/:id/refund-approve', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'payment.refund.approve'))) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const refund = await client.query(`SELECT r.*,p.method,p.branch_id FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE r.id=$1 AND r.company_id=$2 AND r.status='REQUESTED' FOR UPDATE`, [params(request).id, user(request).company_id]);
      if (refund.rowCount !== 1 || !(await allowedBranch(request, refund.rows[0].branch_id))) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Reembolso pendiente no encontrado' }); }
      const result = await client.query(`UPDATE refunds SET status='APPROVED',approved_by=$1,approved_at=now() WHERE id=$2 RETURNING *`, [user(request).id, params(request).id]);
      await audit(client, [user(request).company_id, refund.rows[0].branch_id, user(request).id, 'refund', params(request).id, 'refund.approved', JSON.stringify({ status: 'REQUESTED' }), JSON.stringify(result.rows[0]), null]);
      await client.query('COMMIT');
      return { data: result.rows[0] };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });
}