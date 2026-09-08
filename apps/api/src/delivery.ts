import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import { requireUser, userHasPermission } from './auth.js';

type User = { id: string; company_id: string };

const uuid = z.string().uuid();

export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return phone;
  return `${phone.slice(0, 3)}****${phone.slice(-2)}`;
}

export function maskStreet(street: string | null): string | null {
  if (!street) return null;
  return street.length > 10 ? `${street.slice(0, 8)}…` : street;
}

async function permission(request: FastifyRequest, reply: FastifyReply, code: string): Promise<boolean> {
  if (await userHasPermission((request.user as User).id, code)) return true;
  await reply.code(403).send({ error: 'Permiso insuficiente' });
  return false;
}

function params(request: FastifyRequest): { id: string; branchId: string } { return request.params as { id: string; branchId: string }; }

export async function registerDeliveryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/customers', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'customer.read'))) return;
    const manage = await userHasPermission((request.user as User).id, 'customer.manage');
    const query = (request.query as { q?: string }).q ?? '';
    const pattern = `%${query.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const result = await pool.query(
      `SELECT id, name, phone, email, notes, is_active, created_at FROM customers
       WHERE company_id = $1 AND is_active AND (name ILIKE $2 OR phone ILIKE $2)
       ORDER BY name LIMIT 100`,
      [(request.user as User).company_id, pattern],
    );
    return { data: result.rows.map(row => ({ ...row, phone: manage ? row.phone : maskPhone(row.phone), phone_masked: maskPhone(row.phone) })) };
  });
  app.post('/api/v1/customers', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'customer.manage'))) return;
    const input = z.object({ name: z.string().trim().min(1).max(160), phone: z.string().trim().min(1).max(40), email: z.string().email().max(160).optional().or(z.literal('').transform(() => undefined)), notes: z.string().max(500).optional() }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Datos de cliente invalidos' });
    try {
      const result = await pool.query('INSERT INTO customers (company_id, name, phone, email, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *', [(request.user as User).company_id, input.data.name, input.data.phone, input.data.email ?? null, input.data.notes ?? null]);
      return reply.code(201).send({ data: result.rows[0] });
    } catch (error) { if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'Ya existe un cliente con ese telefono' }); throw error; }
  });
  app.get('/api/v1/customers/:id', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'customer.read'))) return;
    const manage = await userHasPermission((request.user as User).id, 'customer.manage');
    const result = await pool.query('SELECT * FROM customers WHERE id=$1 AND company_id=$2', [params(request).id, (request.user as User).company_id]);
    if (!result.rowCount) return reply.code(404).send({ error: 'Cliente no encontrado' });
    const row = result.rows[0];
    row.phone = manage ? row.phone : maskPhone(row.phone);
    row.phone_masked = maskPhone(result.rows[0].phone);
    return { data: row };
  });
  app.post('/api/v1/customers/:id/addresses', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'customer.manage'))) return;
    const input = z.object({ label: z.string().trim().min(1).max(80), street: z.string().trim().min(1).max(300), neighborhood: z.string().max(160).optional(), city: z.string().max(160).optional(), reference: z.string().max(300).optional() }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Direccion invalida' });
    const customer = await pool.query('SELECT 1 FROM customers WHERE id=$1 AND company_id=$2', [params(request).id, (request.user as User).company_id]);
    if (!customer.rowCount) return reply.code(404).send({ error: 'Cliente no encontrado' });
    try {
      const result = await pool.query('INSERT INTO customer_addresses (customer_id, label, street, neighborhood, city, reference) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [params(request).id, input.data.label, input.data.street, input.data.neighborhood ?? null, input.data.city ?? null, input.data.reference ?? null]);
      return reply.code(201).send({ data: result.rows[0] });
    } catch (error) { if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'Esa etiqueta de direccion ya existe' }); throw error; }
  });
  app.get('/api/v1/customers/:id/addresses', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'customer.read'))) return;
    const manage = await userHasPermission((request.user as User).id, 'customer.manage');
    const customer = await pool.query('SELECT 1 FROM customers WHERE id=$1 AND company_id=$2', [params(request).id, (request.user as User).company_id]);
    if (!customer.rowCount) return reply.code(404).send({ error: 'Cliente no encontrado' });
    const result = await pool.query('SELECT * FROM customer_addresses WHERE customer_id=$1 ORDER BY created_at', [params(request).id]);
    return { data: result.rows.map(row => ({ ...row, street: manage ? row.street : maskStreet(row.street), street_masked: maskStreet(row.street) })) };
  });

  app.get('/api/v1/delivery-zones', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'customer.read'))) return;
    const result = await pool.query('SELECT id, name, fee, is_active FROM delivery_zones WHERE company_id=$1 AND is_active ORDER BY name', [(request.user as User).company_id]);
    return { data: result.rows };
  });
  app.post('/api/v1/delivery-zones', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'delivery.manage'))) return;
    const input = z.object({ name: z.string().trim().min(1).max(120), fee: z.number().nonnegative() }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Zona invalida' });
    try {
      const result = await pool.query('INSERT INTO delivery_zones (company_id, name, fee) VALUES ($1,$2,$3) RETURNING *', [(request.user as User).company_id, input.data.name, input.data.fee]);
      return reply.code(201).send({ data: result.rows[0] });
    } catch (error) { if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'La zona ya existe' }); throw error; }
  });

  app.get('/api/v1/couriers', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'courier.read'))) return;
    const result = await pool.query('SELECT id, name, phone, type, is_active FROM couriers WHERE company_id=$1 ORDER BY name', [(request.user as User).company_id]);
    return { data: result.rows };
  });
  app.post('/api/v1/couriers', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'courier.manage'))) return;
    const input = z.object({ name: z.string().trim().min(1).max(160), phone: z.string().trim().max(40).optional(), type: z.enum(['INTERNAL','EXTERNAL']).default('INTERNAL') }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Repartidor invalido' });
    const result = await pool.query('INSERT INTO couriers (company_id, name, phone, type) VALUES ($1,$2,$3,$4) RETURNING *', [(request.user as User).company_id, input.data.name, input.data.phone ?? null, input.data.type]);
    return reply.code(201).send({ data: result.rows[0] });
  });
  app.patch('/api/v1/couriers/:id', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'courier.manage'))) return;
    const input = z.object({ name: z.string().trim().min(1).max(160).optional(), phone: z.string().trim().max(40).nullable().optional(), type: z.enum(['INTERNAL','EXTERNAL']).optional(), isActive: z.boolean().optional() }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Repartidor invalido' });
    const fields: string[] = []; const values: unknown[] = [];
    if (input.data.name !== undefined) { fields.push('name=$' + (values.length + 1)); values.push(input.data.name); }
    if (input.data.phone !== undefined) { fields.push('phone=$' + (values.length + 1)); values.push(input.data.phone); }
    if (input.data.type !== undefined) { fields.push('type=$' + (values.length + 1)); values.push(input.data.type); }
    if (input.data.isActive !== undefined) { fields.push('is_active=$' + (values.length + 1)); values.push(input.data.isActive); }
    if (!fields.length) return reply.code(400).send({ error: 'Sin cambios' });
    values.push(params(request).id, (request.user as User).company_id);
    const result = await pool.query(`UPDATE couriers SET ${fields.join(', ')}, updated_at=now() WHERE id=$${values.length - 1} AND company_id=$${values.length} RETURNING *`, values);
    if (!result.rowCount) return reply.code(404).send({ error: 'Repartidor no encontrado' });
    return { data: result.rows[0] };
  });

  app.get('/api/v1/branches/:branchId/delivery/queue', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'delivery.manage'))) return;
    const { branchId } = params(request);
    const branch = await pool.query('SELECT 1 FROM branches b JOIN user_branches ub ON ub.branch_id=b.id WHERE b.id=$1 AND b.company_id=$2 AND ub.user_id=$3', [branchId, (request.user as User).company_id, (request.user as User).id]);
    if (!branch.rowCount) return reply.code(403).send({ error: 'Sucursal no autorizada' });
    const manage = await userHasPermission((request.user as User).id, 'customer.manage');
    const result = await pool.query(
      `SELECT o.id, o.folio, o.status, o.delivery_status, o.total, o.delivery_fee, o.needs_attention, o.attention_reason, o.created_at,
         c.name customer_name, c.phone customer_phone, c.email customer_email,
         a.label address_label, a.street address_street, a.neighborhood address_neighborhood, a.city address_city, a.reference address_reference,
         z.name zone_name, cou.name courier_name
       FROM orders o
       LEFT JOIN customers c ON c.id=o.customer_id
       LEFT JOIN customer_addresses a ON a.id=o.address_id
       LEFT JOIN delivery_zones z ON z.id=o.delivery_zone_id
       LEFT JOIN couriers cou ON cou.id=o.courier_id
       WHERE o.company_id=$1 AND o.branch_id=$2 AND o.channel='DELIVERY' AND o.status NOT IN ('DRAFT','CANCELLED')
         AND o.delivery_status IS DISTINCT FROM 'DELIVERED'
       ORDER BY o.created_at`,
      [(request.user as User).company_id, branchId],
    );
    return { data: result.rows.map(row => ({ ...row, customer_phone: manage ? row.customer_phone : maskPhone(row.customer_phone), customer_phone_masked: maskPhone(row.customer_phone), address_street: manage ? row.address_street : maskStreet(row.address_street), address_street_masked: maskStreet(row.address_street) })) };
  });

  app.post('/api/v1/orders/:id/assign-courier', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'delivery.manage'))) return;
    const input = z.object({ courierId: uuid, idempotencyKey: z.string().trim().min(8).max(120).optional() }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Repartidor invalido' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const order = await client.query('SELECT * FROM orders WHERE id=$1 AND company_id=$2 FOR UPDATE', [params(request).id, (request.user as User).company_id]);
      if (!order.rowCount) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Pedido no encontrado' }); }
      const row = order.rows[0];
      if (row.channel !== 'DELIVERY') { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Pedido no es a domicilio' }); }
      if (row.delivery_status === 'DELIVERED' || row.delivery_status === 'OUT_FOR_DELIVERY') { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'La entrega ya esta en curso' }); }
      const courier = await client.query('SELECT 1 FROM couriers WHERE id=$1 AND company_id=$2 AND is_active', [input.data.courierId, (request.user as User).company_id]);
      if (!courier.rowCount) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Repartidor no encontrado' }); }
      const updated = await client.query("UPDATE orders SET courier_id=$1, delivery_status='COURIER_ASSIGNED', needs_attention=false, attention_reason=NULL, updated_at=now() WHERE id=$2 RETURNING *", [input.data.courierId, row.id]);
      await client.query("INSERT INTO order_events (order_id,event_type,actor_id,reason,idempotency_key) VALUES ($1,'DELIVERY_ASSIGNED',$2,$3,$4)", [row.id, (request.user as User).id, `Repartidor asignado`, input.data.idempotencyKey ?? null]);
      await client.query(`INSERT INTO audit_logs (company_id,branch_id,actor_id,entity_type,entity_id,action,new_values) VALUES ($1,$2,$3,'order',$4,'delivery.assigned',$5)`, [row.company_id, row.branch_id, (request.user as User).id, row.id, JSON.stringify({ courierId: input.data.courierId })]);
      await client.query('COMMIT');
      return { data: updated.rows[0] };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });

  async function deliverTransition(request: FastifyRequest, reply: FastifyReply, target: 'OUT_FOR_DELIVERY' | 'DELIVERED', requiresCourier: boolean): Promise<unknown> {
    if (!(await permission(request, reply, 'delivery.manage'))) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const order = await client.query('SELECT * FROM orders WHERE id=$1 AND company_id=$2 FOR UPDATE', [params(request).id, (request.user as User).company_id]);
      if (!order.rowCount) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Pedido no encontrado' }); }
      const row = order.rows[0];
      if (row.channel !== 'DELIVERY') { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Pedido no es a domicilio' }); }
      if (requiresCourier && !row.courier_id) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Asigna un repartidor primero' }); }
      const allowed = target === 'OUT_FOR_DELIVERY' ? ['COURIER_ASSIGNED', 'PENDING'] : ['COURIER_ASSIGNED', 'OUT_FOR_DELIVERY'];
      if (!allowed.includes(row.delivery_status ?? 'PENDING')) { await client.query('ROLLBACK'); return reply.code(409).send({ error: target === 'DELIVERED' ? 'La entrega no esta en ruta' : 'La entrega no puede salir ahora' }); }
      const updated = await client.query(`UPDATE orders SET delivery_status='${target}', needs_attention=false, attention_reason=NULL, updated_at=now() WHERE id=$1 RETURNING *`, [row.id]);
      await client.query(`INSERT INTO order_events (order_id,event_type,actor_id) VALUES ($1,'DELIVERY_${target}', $2)`, [row.id, (request.user as User).id]);
      await client.query(`INSERT INTO audit_logs (company_id,branch_id,actor_id,entity_type,entity_id,action) VALUES ($1,$2,$3,'order',$4,'delivery.${target.toLowerCase()}')`, [row.company_id, row.branch_id, (request.user as User).id, row.id]);
      await client.query('COMMIT');
      return { data: updated.rows[0] };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  app.post('/api/v1/orders/:id/out-for-delivery', { preHandler: requireUser }, async (request, reply) => deliverTransition(request, reply, 'OUT_FOR_DELIVERY', true));
  app.post('/api/v1/orders/:id/delivered', { preHandler: requireUser }, async (request, reply) => deliverTransition(request, reply, 'DELIVERED', true));

  app.post('/api/v1/orders/:id/flag-attention', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'delivery.manage'))) return;
    const input = z.object({ reason: z.string().trim().min(1).max(500) }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Motivo requerido' });
    const result = await pool.query("UPDATE orders SET needs_attention=true, attention_reason=$1, updated_at=now() WHERE id=$2 AND company_id=$3 RETURNING *", [input.data.reason, params(request).id, (request.user as User).company_id]);
    if (!result.rowCount) return reply.code(404).send({ error: 'Pedido no encontrado' });
    await pool.query("INSERT INTO order_events (order_id,event_type,actor_id,reason) VALUES ($1,'DELIVERY_ESCALATED',$2,$3)", [params(request).id, (request.user as User).id, input.data.reason]);
    return { data: result.rows[0] };
  });

  app.post('/api/v1/orders/confirm-by-token', async (request, reply) => {
    const input = z.object({ token: z.string().trim().min(8).max(120) }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Token invalido' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const order = await client.query("SELECT id, branch_id, company_id, client_confirmed_at FROM orders WHERE client_confirmation_token=$1 AND channel IN ('TAKEOUT','DELIVERY') FOR UPDATE", [input.data.token]);
      if (!order.rowCount) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Pedido no encontrado' }); }
      if (order.rows[0].client_confirmed_at) { await client.query('ROLLBACK'); return { data: { confirmed: true }, idempotent: true }; }
      const row = order.rows[0];
      await client.query("UPDATE orders SET client_confirmed_at=now(), client_confirm_method='LINK', needs_attention=false, attention_reason=NULL WHERE id=$1", [row.id]);
      await client.query("INSERT INTO order_events (order_id,event_type,reason) VALUES ($1,'CUSTOMER_CONFIRMED','Confirmacion del cliente por enlace')", [row.id]);
      await client.query(`INSERT INTO audit_logs (company_id,branch_id,actor_id,entity_type,entity_id,action) VALUES ($1,$2,NULL,'order',$3,'customer.confirmed')`, [row.company_id, row.branch_id, row.id]);
      await client.query('COMMIT');
      return { data: { confirmed: true }, idempotent: false };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });
}