import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import { requireUser, userHasPermission } from './auth.js';
import { publishKitchenEvent } from './kitchen-events.js';

type User = { id: string; company_id: string };
const uuid = z.string().uuid();
async function allowedBranch(request: FastifyRequest, branchId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM branches b JOIN user_branches ub ON ub.branch_id = b.id
     WHERE b.id = $1 AND b.company_id = $2 AND b.is_active AND ub.user_id = $3`,
    [branchId, (request.user as User).company_id, (request.user as User).id],
  );
  return result.rowCount === 1;
}

async function permission(request: FastifyRequest, reply: FastifyReply, code: string): Promise<boolean> {
  if (!(await userHasPermission((request.user as User).id, code))) {
    await reply.code(403).send({ error: 'Permiso insuficiente' });
    return false;
  }
  return true;
}

function params(request: FastifyRequest): { id: string } { return request.params as { id: string }; }

export async function registerCatalogOrderRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/categories', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'catalog.read'))) return;
    const result = await pool.query('SELECT id, name, description, sort_order, is_active FROM categories WHERE company_id = $1 ORDER BY sort_order, name', [(request.user as User).company_id]);
    return { data: result.rows };
  });
  app.post('/api/v1/categories', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'catalog.manage'))) return;
    const input = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(500).optional(), sortOrder: z.number().int().default(0) }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Categoria invalida' });
    try {
      const result = await pool.query('INSERT INTO categories (company_id, name, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING *', [(request.user as User).company_id, input.data.name, input.data.description ?? null, input.data.sortOrder]);
      return reply.code(201).send({ data: result.rows[0] });
    } catch (error) { if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'La categoria ya existe' }); throw error; }
  });
  app.get('/api/v1/products', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'catalog.read'))) return;
    const result = await pool.query(`SELECT p.id, p.name, p.description, p.category_id, p.is_active,
      COALESCE(json_agg(json_build_object('id',v.id,'name',v.name,'price',v.price) ORDER BY v.name) FILTER (WHERE v.id IS NOT NULL), '[]') variants
      FROM products p LEFT JOIN product_variants v ON v.product_id=p.id WHERE p.company_id=$1 GROUP BY p.id ORDER BY p.name`, [(request.user as User).company_id]);
    return { data: result.rows };
  });
  app.post('/api/v1/products', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'catalog.manage'))) return;
    const input = z.object({ categoryId: uuid, name: z.string().trim().min(1).max(160), description: z.string().max(500).optional(), sku: z.string().max(80).optional(), variants: z.array(z.object({ name: z.string().trim().min(1).max(100), price: z.number().nonnegative(), isDefault: z.boolean().default(false) })).min(1) }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Producto invalido' });
    const client = await pool.connect();
    try { await client.query('BEGIN');
      const product = await client.query('INSERT INTO products (company_id, category_id, name, description, sku) SELECT $1,id,$3,$4,$5 FROM categories WHERE id=$2 AND company_id=$1 RETURNING *', [(request.user as User).company_id, input.data.categoryId, input.data.name, input.data.description ?? null, input.data.sku ?? null]);
      if (product.rowCount !== 1) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Categoria no encontrada' }); }
      for (const variant of input.data.variants) {
        const inserted = await client.query('INSERT INTO product_variants (product_id,name,price,is_default) VALUES ($1,$2,$3,$4) RETURNING id', [product.rows[0].id, variant.name, variant.price, variant.isDefault]);
        await client.query('INSERT INTO product_prices (variant_id,price) VALUES ($1,$2)', [inserted.rows[0].id, variant.price]);
      }
      await client.query('COMMIT'); return reply.code(201).send({ data: product.rows[0] });
    } catch (error) { await client.query('ROLLBACK'); if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'Producto o variante duplicado' }); throw error; } finally { client.release(); }
  });
  app.get('/api/v1/branches/:branchId/menu', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'catalog.read'))) return;
    const branchId = (request.params as { branchId: string }).branchId;
    if (!uuid.safeParse(branchId).success || !(await allowedBranch(request, branchId))) return reply.code(403).send({ error: 'Sucursal no autorizada' });
    const result = await pool.query(`SELECT p.id,p.name,p.description,c.name category_name,
      COALESCE(a.is_available,true) is_available, json_agg(json_build_object('id',v.id,'name',v.name,'price',v.price) ORDER BY v.name) variants
      FROM products p JOIN categories c ON c.id=p.category_id JOIN product_variants v ON v.product_id=p.id
      LEFT JOIN branch_product_availability a ON a.product_id=p.id AND a.branch_id=$1
      WHERE p.company_id=$2 AND p.is_active AND c.is_active AND v.is_active GROUP BY p.id,c.name,a.is_available ORDER BY c.sort_order,p.name`, [branchId, (request.user as User).company_id]);
    return { data: result.rows };
  });
  app.patch('/api/v1/branches/:branchId/products/:productId/availability', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'catalog.manage'))) return;
    const { branchId, productId } = request.params as { branchId: string; productId: string }; const input = z.object({ isAvailable: z.boolean() }).safeParse(request.body);
    if (!input.success || !uuid.safeParse(branchId).success || !uuid.safeParse(productId).success || !(await allowedBranch(request, branchId))) return reply.code(400).send({ error: 'Sucursal o disponibilidad invalida' });
    const result = await pool.query(`INSERT INTO branch_product_availability (branch_id,product_id,is_available,updated_by) SELECT $1,id,$3,$4 FROM products WHERE id=$2 AND company_id=$5 ON CONFLICT (branch_id,product_id) DO UPDATE SET is_available=EXCLUDED.is_available,updated_at=now(),updated_by=EXCLUDED.updated_by RETURNING *`, [branchId, productId, input.data.isAvailable, (request.user as User).id, (request.user as User).company_id]);
    if (result.rowCount !== 1) return reply.code(404).send({ error: 'Producto no encontrado' });
    await pool.query(`INSERT INTO audit_logs (company_id,branch_id,actor_id,entity_type,entity_id,action,new_values) VALUES ($1,$2,$3,'product',$4,'availability.changed',$5)`, [(request.user as User).company_id, branchId, (request.user as User).id, productId, JSON.stringify(input.data)]);
    return { data: result.rows[0] };
  });
  app.get('/api/v1/branches/:branchId/tables', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'order.read'))) return;
    const branchId = (request.params as { branchId: string }).branchId; if (!(await allowedBranch(request, branchId))) return reply.code(403).send({ error: 'Sucursal no autorizada' });
    const result = await pool.query('SELECT id,name,capacity,status FROM restaurant_tables WHERE branch_id=$1 AND company_id=$2 ORDER BY name', [branchId, (request.user as User).company_id]); return { data: result.rows };
  });
  app.post('/api/v1/tables', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'order.manage'))) return;
    const input = z.object({ branchId: uuid, name: z.string().trim().min(1).max(60), capacity: z.number().int().positive(), status: z.enum(['AVAILABLE','DISABLED']).default('AVAILABLE') }).safeParse(request.body); if (!input.success || !(await allowedBranch(request, input.success ? input.data.branchId : ''))) return reply.code(400).send({ error: 'Mesa invalida' });
    try { const result = await pool.query('INSERT INTO restaurant_tables (company_id,branch_id,name,capacity,status) VALUES ($1,$2,$3,$4,$5) RETURNING *', [(request.user as User).company_id, input.data.branchId, input.data.name, input.data.capacity, input.data.status]); return reply.code(201).send({ data: result.rows[0] }); } catch (error) { if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'La mesa ya existe' }); throw error; }
  });
  app.post('/api/v1/orders', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'order.create'))) return;
    const input = z.object({ branchId: uuid, tableId: uuid.optional(), channel: z.enum(['DINE_IN','TAKEOUT','DELIVERY']).default('DINE_IN'), notes: z.string().max(500).optional(), idempotencyKey: z.string().trim().min(8).max(120) }).safeParse(request.body); if (!input.success || !(await allowedBranch(request, input.success ? input.data.branchId : ''))) return reply.code(400).send({ error: 'Pedido invalido' });
    const existing = await pool.query('SELECT * FROM orders WHERE company_id=$1 AND branch_id=$2 AND idempotency_key=$3', [(request.user as User).company_id, input.data.branchId, input.data.idempotencyKey]); if (existing.rowCount) return { data: existing.rows[0], idempotent: true };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (input.data.tableId) {
        const table = await client.query('SELECT 1 FROM restaurant_tables WHERE id=$1 AND branch_id=$2 AND company_id=$3 AND status <> \'DISABLED\'', [input.data.tableId, input.data.branchId, (request.user as User).company_id]);
        if (!table.rowCount) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Mesa no pertenece a la sucursal' }); }
      }
      const sequence = await client.query('INSERT INTO branch_order_sequences (branch_id) VALUES ($1) ON CONFLICT (branch_id) DO UPDATE SET next_folio=branch_order_sequences.next_folio+1 RETURNING next_folio AS folio', [input.data.branchId]);
      const result = await client.query('INSERT INTO orders (company_id,branch_id,table_id,folio,channel,notes,idempotency_key,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [(request.user as User).company_id, input.data.branchId, input.data.tableId ?? null, sequence.rows[0].folio, input.data.channel, input.data.notes ?? null, input.data.idempotencyKey, (request.user as User).id]);
      await client.query('INSERT INTO order_events (order_id,event_type,to_status,actor_id,idempotency_key) VALUES ($1,\'CREATED\',\'DRAFT\',$2,$3)', [result.rows[0].id, (request.user as User).id, input.data.idempotencyKey]);
      await client.query('COMMIT');
      return reply.code(201).send({ data: result.rows[0], idempotent: false });
    } catch (error) { await client.query('ROLLBACK'); if ((error as { code?: string }).code === '23505') { const existing = await pool.query('SELECT * FROM orders WHERE company_id=$1 AND branch_id=$2 AND idempotency_key=$3', [(request.user as User).company_id, input.data.branchId, input.data.idempotencyKey]); if (existing.rowCount) return { data: existing.rows[0], idempotent: true }; } throw error; } finally { client.release(); }
  });
  app.post('/api/v1/orders/:id/items', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'order.create'))) return;
    const input = z.object({ productId: uuid, variantId: uuid, quantity: z.number().int().positive(), notes: z.string().max(500).optional(), modifierIds: z.array(uuid).default([]) }).safeParse(request.body); if (!input.success) return reply.code(400).send({ error: 'Detalle invalido' });
    const orderId = params(request).id; const client = await pool.connect();
    try { await client.query('BEGIN'); const order = await client.query('SELECT branch_id,company_id,status FROM orders WHERE id=$1 AND company_id=$2 FOR UPDATE', [orderId, (request.user as User).company_id]); if (order.rowCount !== 1 || order.rows[0].status !== 'DRAFT') { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'El pedido no admite detalles' }); }
      const product = await client.query(`SELECT p.name product_name,v.name variant_name,v.price FROM products p JOIN product_variants v ON v.product_id=p.id LEFT JOIN branch_product_availability a ON a.product_id=p.id AND a.branch_id=$3 WHERE p.id=$1 AND v.id=$2 AND p.company_id=$4 AND p.is_active AND v.is_active AND COALESCE(a.is_available,true)`, [input.data.productId,input.data.variantId,order.rows[0].branch_id,(request.user as User).company_id]); if (product.rowCount !== 1) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Producto no disponible' }); }
      const item = await client.query('INSERT INTO order_items (order_id,product_id,variant_id,quantity,product_name,variant_name,unit_price,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [orderId,input.data.productId,input.data.variantId,input.data.quantity,product.rows[0].product_name,product.rows[0].variant_name,product.rows[0].price,input.data.notes ?? null]);
      if (input.data.modifierIds.length) {
        const modifiers = await client.query(`SELECT m.id,m.name,m.price_delta FROM modifiers m JOIN product_modifier_groups pmg ON pmg.modifier_group_id=m.modifier_group_id WHERE pmg.product_id=$1 AND m.id=ANY($2::uuid[]) AND m.is_active`, [input.data.productId, input.data.modifierIds]);
        if (modifiers.rowCount !== input.data.modifierIds.length) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Modificador no disponible para el producto' }); }
        await client.query(`INSERT INTO order_item_modifiers (order_item_id,modifier_id,name,price_delta) SELECT $1,m.id,m.name,m.price_delta FROM modifiers m WHERE m.id=ANY($2::uuid[])`, [item.rows[0].id, input.data.modifierIds]);
      }
      await client.query('COMMIT'); return reply.code(201).send({ data: item.rows[0] });
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });
  app.post('/api/v1/orders/:id/confirm', { preHandler: requireUser }, async (request, reply) => updateOrderStatus(request, reply, 'order.manage', 'CONFIRMED'));
  app.post('/api/v1/orders/:id/send-to-kitchen', { preHandler: requireUser }, async (request, reply) => { if (!(await permission(request, reply, 'kitchen.send'))) return; const input = z.object({ idempotencyKey: z.string().trim().min(8).max(120) }).safeParse(request.body); if (!input.success) return reply.code(400).send({ error: 'Clave de idempotencia invalida' }); return sendKitchen(request, reply, input.data.idempotencyKey); });
  app.get('/api/v1/orders/:id', { preHandler: requireUser }, async (request, reply) => getOrder(request, reply, false));
  app.get('/api/v1/orders/:id/events', { preHandler: requireUser }, async (request, reply) => getOrder(request, reply, true));
  app.post('/api/v1/orders/:id/cancellation-request', { preHandler: requireUser }, async (request, reply) => { const input = z.object({ reason: z.string().trim().min(1).max(500) }).safeParse(request.body); if (!input.success) return reply.code(400).send({ error: 'Motivo requerido' }); return updateOrderStatus(request, reply, 'order.manage', 'CANCELLATION_REQUESTED', input.data.reason); });
}

async function updateOrderStatus(request: FastifyRequest, reply: FastifyReply, permissionCode: string, target: string, reason?: string) {
  if (!(await permission(request, reply, permissionCode))) return; const client = await pool.connect(); try { await client.query('BEGIN'); const result = await client.query('SELECT * FROM orders WHERE id=$1 AND company_id=$2 FOR UPDATE', [params(request).id,(request.user as User).company_id]); if (result.rowCount !== 1) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Pedido no encontrado' }); } const order=result.rows[0]; const valid=(target==='CONFIRMED' && order.status==='DRAFT') || (target==='CANCELLATION_REQUESTED' && ['CONFIRMED','SENT_TO_KITCHEN'].includes(order.status)); if (!valid) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Transicion de estado invalida' }); } const total=target==='CONFIRMED' ? (await client.query('SELECT COALESCE(SUM(oi.quantity * (oi.unit_price + COALESCE(modifier_total,0))),0) total FROM order_items oi LEFT JOIN (SELECT order_item_id,SUM(price_delta) modifier_total FROM order_item_modifiers GROUP BY order_item_id) modifiers ON modifiers.order_item_id=oi.id WHERE oi.order_id=$1',[order.id])).rows[0].total : order.total; if (target==='CONFIRMED' && Number(total) === 0) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'El pedido requiere al menos un articulo' }); } const updated=await client.query('UPDATE orders SET status=$1,total=$2,updated_at=now() WHERE id=$3 RETURNING *',[target,total,order.id]); await client.query('INSERT INTO order_events (order_id,event_type,from_status,to_status,actor_id,reason) VALUES ($1,$2,$3,$4,$5,$6)',[order.id,target,order.status,target,(request.user as User).id,reason ?? null]); await client.query('INSERT INTO audit_logs (company_id,branch_id,actor_id,entity_type,entity_id,action,reason) VALUES ($1,$2,$3,\'order\',$4,$5,$6)',[order.company_id,order.branch_id,(request.user as User).id,order.id,`status.${target.toLowerCase()}`,reason ?? null]); await client.query('COMMIT'); return { data: updated.rows[0] }; } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } }

async function sendKitchen(request: FastifyRequest, reply: FastifyReply, key: string) { const client=await pool.connect(); try { await client.query('BEGIN'); const order=(await client.query('SELECT * FROM orders WHERE id=$1 AND company_id=$2 FOR UPDATE',[params(request).id,(request.user as User).company_id])).rows[0]; if (!order) { await client.query('ROLLBACK'); return reply.code(404).send({error:'Pedido no encontrado'}); } const prior=await client.query('SELECT id FROM order_events WHERE order_id=$1 AND event_type=\'SENT_TO_KITCHEN\' AND idempotency_key=$2',[order.id,key]); if(prior.rowCount) { await client.query('ROLLBACK'); return {data:order,idempotent:true}; } if(!['CONFIRMED','SENT_TO_KITCHEN'].includes(order.status)) { await client.query('ROLLBACK'); return reply.code(409).send({error:'El pedido no puede enviarse a cocina'}); } const items=await client.query('UPDATE order_items SET sent_at=now() WHERE order_id=$1 AND sent_at IS NULL RETURNING id',[order.id]); if(!items.rowCount && order.status==='CONFIRMED') { await client.query('ROLLBACK'); return reply.code(409).send({error:'No hay articulos pendientes de enviar'}); } const updated=await client.query('UPDATE orders SET status=\'SENT_TO_KITCHEN\',kitchen_status=COALESCE(kitchen_status,\'PENDING\'),updated_at=now() WHERE id=$1 RETURNING *',[order.id]); await client.query('INSERT INTO order_events (order_id,event_type,from_status,to_status,actor_id,idempotency_key) VALUES ($1,\'SENT_TO_KITCHEN\',$2,\'SENT_TO_KITCHEN\',$3,$4)',[order.id,order.status,(request.user as User).id,key]); await client.query('COMMIT'); publishKitchenEvent((request.user as User).company_id, { id: crypto.randomUUID(), type: 'order.sent_to_kitchen', branchId: updated.rows[0].branch_id, orderId: updated.rows[0].id, status: updated.rows[0].kitchen_status, occurredAt: new Date().toISOString() }); return {data:updated.rows[0],sentItems:items.rowCount,idempotent:false}; } catch(error) { await client.query('ROLLBACK'); throw error; } finally {client.release();} }

async function getOrder(request: FastifyRequest, reply: FastifyReply, events: boolean) { if (!(await permission(request,reply,'order.read'))) return; const result=await pool.query('SELECT * FROM orders WHERE id=$1 AND company_id=$2',[params(request).id,(request.user as User).company_id]); if(!result.rowCount) return reply.code(404).send({error:'Pedido no encontrado'}); if(events) return {data:(await pool.query('SELECT * FROM order_events WHERE order_id=$1 ORDER BY created_at',[params(request).id])).rows}; return {data:result.rows[0],items:(await pool.query('SELECT oi.*,COALESCE(json_agg(oim) FILTER (WHERE oim.id IS NOT NULL),\'[]\') modifiers FROM order_items oi LEFT JOIN order_item_modifiers oim ON oim.order_item_id=oi.id WHERE oi.order_id=$1 GROUP BY oi.id ORDER BY oi.created_at',[params(request).id])).rows}; }