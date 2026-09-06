import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import { requireUser, userHasPermission } from './auth.js';
import { addMovement, conversionFactor } from './inventory.js';
import { convertQuantity } from './inventory-domain.js';

type User = { id: string; company_id: string };
const uuid = z.string().uuid();
const quantity = z.string().regex(/^\d+(\.\d{1,8})?$/).refine((value) => Number(value) > 0);
const unitPrice = z.number().nonnegative().multipleOf(0.01);
const userOf = (request: FastifyRequest) => request.user as User;

function trimmed(value: number): string {
  return value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

async function permission(request: FastifyRequest, reply: FastifyReply, code: string): Promise<boolean> {
  if (!(await userHasPermission(userOf(request).id, code))) {
    await reply.code(403).send({ error: 'Permiso insuficiente' });
    return false;
  }
  return true;
}

async function allowedBranch(request: FastifyRequest, branchId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM branches b JOIN user_branches ub ON ub.branch_id = b.id
     WHERE b.id = $1 AND b.company_id = $2 AND b.is_active AND ub.user_id = $3`,
    [branchId, userOf(request).company_id, userOf(request).id],
  );
  return result.rowCount === 1;
}

type Client = { query: (text: string, values?: unknown[]) => Promise<{ rowCount: number; rows: any[] }> };

async function audit(client: Client, user: User, branchId: string | null, entityType: string, entityId: string, action: string, reason?: string): Promise<void> {
  await client.query(`INSERT INTO audit_logs (company_id,branch_id,actor_id,entity_type,entity_id,action,reason)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`, [user.company_id, branchId, user.id, entityType, entityId, action, reason ?? null]);
}

async function validPurchaseItem(client: Client, companyId: string, ingredientId: string, unitId: string): Promise<boolean> {
  const result = await client.query(`SELECT i.id, i.base_unit_id, u.id unit_id
    FROM ingredients i JOIN units u ON u.id=$2
    WHERE i.id=$1 AND i.company_id=$3 AND i.is_active AND (u.company_id=$3 OR u.company_id IS NULL) AND u.is_active`,
  [ingredientId, unitId, companyId]);
  if (result.rowCount !== 1) return false;
  if (String(result.rows[0].base_unit_id) === unitId) return true;
  return (await conversionFactor(client, companyId, unitId, result.rows[0].base_unit_id)) !== null;
}

export async function registerPurchasingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/suppliers', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'purchase.read'))) return;
    const result = await pool.query('SELECT id,name,tax_id,contact_name,phone,email,address,notes,is_active,created_at FROM suppliers WHERE company_id=$1 ORDER BY name', [userOf(request).company_id]);
    return { data: result.rows };
  });

  app.post('/api/v1/suppliers', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'purchase.manage'))) return;
    const input = z.object({
      name: z.string().trim().min(1).max(160), taxId: z.string().trim().max(40).optional(),
      contactName: z.string().trim().max(120).optional(), phone: z.string().trim().max(40).optional(),
      email: z.string().email().optional(), address: z.string().trim().max(500).optional(), notes: z.string().trim().max(500).optional(),
    }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Proveedor invalido' });
    try {
      const result = await pool.query('INSERT INTO suppliers (company_id,name,tax_id,contact_name,phone,email,address,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [userOf(request).company_id, input.data.name, input.data.taxId ?? null, input.data.contactName ?? null, input.data.phone ?? null, input.data.email ?? null, input.data.address ?? null, input.data.notes ?? null]);
      await pool.query(`INSERT INTO audit_logs (company_id,actor_id,entity_type,entity_id,action) VALUES ($1,$2,'supplier',$3,'supplier.created')`, [userOf(request).company_id, userOf(request).id, result.rows[0].id]);
      return reply.code(201).send({ data: result.rows[0] });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'El proveedor ya existe' });
      throw error;
    }
  });

  app.get('/api/v1/purchase-orders', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'purchase.read'))) return;
    const query = request.query as { branchId?: string; status?: string };
    if (!query.branchId || !uuid.safeParse(query.branchId).success || !(await allowedBranch(request, query.branchId))) return reply.code(403).send({ error: 'Sucursal no autorizada' });
    const status = query.status && ['DRAFT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'].includes(query.status) ? query.status : null;
    const result = await pool.query(`SELECT po.*, s.name supplier_name FROM purchase_orders po
      JOIN suppliers s ON s.id=po.supplier_id WHERE po.company_id=$1 AND po.branch_id=$2 AND ($3::text IS NULL OR po.status=$3) ORDER BY po.created_at DESC`,
    [userOf(request).company_id, query.branchId, status]);
    return { data: result.rows };
  });

  app.get('/api/v1/purchase-orders/:id', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'purchase.read'))) return;
    const id = (request.params as { id: string }).id;
    if (!uuid.safeParse(id).success) return reply.code(400).send({ error: 'Orden de compra invalida' });
    const po = await pool.query(`SELECT po.*, s.name supplier_name FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id WHERE po.id=$1 AND po.company_id=$2`, [id, userOf(request).company_id]);
    if (po.rowCount !== 1) return reply.code(404).send({ error: 'Orden de compra no encontrada' });
    if (!(await allowedBranch(request, po.rows[0].branch_id))) return reply.code(403).send({ error: 'Sucursal no autorizada' });
    const items = await pool.query(`SELECT poi.id,poi.ingredient_id,i.name ingredient_name,poi.quantity,poi.unit_id,u.code unit_code,poi.unit_price,poi.received_quantity
      FROM purchase_order_items poi JOIN ingredients i ON i.id=poi.ingredient_id JOIN units u ON u.id=poi.unit_id
      WHERE poi.purchase_order_id=$1 ORDER BY i.name`, [id]);
    const receipts = await pool.query(`SELECT pr.*, w.name warehouse_name FROM purchase_receipts pr JOIN warehouses w ON w.id=pr.warehouse_id WHERE pr.purchase_order_id=$1 ORDER BY pr.received_at`, [id]);
    const returns = await pool.query(`SELECT pr2.*, w.name warehouse_name, (SELECT json_agg(json_build_object('ingredient_id', pri.ingredient_id, 'ingredient_name', i.name, 'quantity_returned', pri.quantity_returned, 'unit_code', u.code) ORDER BY pri.id)) items
      FROM purchase_returns pr2 JOIN warehouses w ON w.id=pr2.warehouse_id
      LEFT JOIN purchase_return_items pri ON pri.purchase_return_id=pr2.id
      LEFT JOIN ingredients i ON i.id=pri.ingredient_id LEFT JOIN units u ON u.id=pri.unit_id
      WHERE pr2.purchase_order_id=$1 GROUP BY pr2.id, w.name ORDER BY pr2.created_at`, [id]);
    const lines = await pool.query(`SELECT poi.id, poi.ingredient_id, i.name ingredient_name, poi.received_quantity, COALESCE(rt.returned,0) returned_quantity FROM purchase_order_items poi
      JOIN ingredients i ON i.id=poi.ingredient_id
      LEFT JOIN (SELECT pri.purchase_order_item_id, SUM(pri.quantity_returned) returned FROM purchase_return_items pri GROUP BY pri.purchase_order_item_id) rt ON rt.purchase_order_item_id=poi.id
      WHERE poi.purchase_order_id=$1`, [id]);
    return { data: { ...po.rows[0], items: items.rows, receipts: receipts.rows, returns: returns.rows, lines: lines.rows } };
  });

  app.post('/api/v1/purchase-orders', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'purchase.manage'))) return;
    const input = z.object({
      branchId: uuid, supplierId: uuid, expectedAt: z.string().date().optional(), notes: z.string().max(500).optional(),
      idempotencyKey: z.string().trim().min(8).max(120),
      items: z.array(z.object({ ingredientId: uuid, quantity, unitId: uuid, unitPrice })).min(1),
    }).safeParse(request.body);
    if (!input.success || !(await allowedBranch(request, input.success ? input.data.branchId : ''))) return reply.code(400).send({ error: 'Orden de compra invalida' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const supplier = await client.query('SELECT id FROM suppliers WHERE id=$1 AND company_id=$2 AND is_active', [input.data.supplierId, userOf(request).company_id]);
      if (supplier.rowCount !== 1) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Proveedor invalido' }); }
      for (const item of input.data.items) {
        if (!(await validPurchaseItem(client, userOf(request).company_id, item.ingredientId, item.unitId))) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Ingrediente o unidad sin conversion configurada' }); }
      }
      const sequence = await client.query('INSERT INTO branch_purchase_sequences (branch_id) VALUES ($1) ON CONFLICT (branch_id) DO UPDATE SET next_folio=branch_purchase_sequences.next_folio+1 RETURNING next_folio AS folio', [input.data.branchId]);
      const result = await client.query('INSERT INTO purchase_orders (company_id,branch_id,supplier_id,folio,expected_at,notes,idempotency_key,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [userOf(request).company_id, input.data.branchId, input.data.supplierId, sequence.rows[0].folio, input.data.expectedAt ?? null, input.data.notes ?? null, input.data.idempotencyKey, userOf(request).id]);
      for (const item of input.data.items) await client.query('INSERT INTO purchase_order_items (purchase_order_id,ingredient_id,quantity,unit_id,unit_price) VALUES ($1,$2,$3,$4,$5)', [result.rows[0].id, item.ingredientId, item.quantity, item.unitId, item.unitPrice]);
      await audit(client, userOf(request), input.data.branchId, 'purchase_order', result.rows[0].id, 'purchase_order.created');
      await client.query('COMMIT');
      return reply.code(201).send({ data: result.rows[0], items: input.data.items });
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') {
        const existing = await pool.query('SELECT * FROM purchase_orders WHERE company_id=$1 AND branch_id=$2 AND idempotency_key=$3', [userOf(request).company_id, input.data.branchId, input.data.idempotencyKey]);
        if (existing.rowCount) return { data: existing.rows[0], idempotent: true };
        return reply.code(409).send({ error: 'Orden de compra duplicada' });
      }
      throw error;
    } finally { client.release(); }
  });

  app.post('/api/v1/purchase-orders/:id/receive', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'purchase.receive'))) return;
    const input = z.object({
      warehouseId: uuid, idempotencyKey: z.string().trim().min(8).max(120), notes: z.string().max(500).optional(),
      items: z.array(z.object({ ingredientId: uuid, quantityReceived: quantity, unitPrice: unitPrice.optional() })).min(1),
    }).safeParse(request.body);
    const orderId = (request.params as { id: string }).id;
    if (!input.success || !uuid.safeParse(orderId).success) return reply.code(400).send({ error: 'Recepcion invalida' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const prior = await client.query('SELECT * FROM purchase_receipts WHERE idempotency_key=$1', [input.data.idempotencyKey]);
      if (prior.rowCount) { await client.query('ROLLBACK'); return { data: prior.rows[0], idempotent: true }; }
      const order = await client.query('SELECT * FROM purchase_orders WHERE id=$1 AND company_id=$2 FOR UPDATE', [orderId, userOf(request).company_id]);
      if (order.rowCount !== 1) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Orden de compra no encontrada' }); }
      if (!(await allowedBranch(request, order.rows[0].branch_id))) { await client.query('ROLLBACK'); return reply.code(403).send({ error: 'Sucursal no autorizada' }); }
      if (['RECEIVED', 'CANCELLED'].includes(order.rows[0].status)) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'La orden no admite recepciones' }); }
      const warehouse = await client.query('SELECT id FROM warehouses WHERE id=$1 AND company_id=$2 AND branch_id=$3 AND is_active', [input.data.warehouseId, userOf(request).company_id, order.rows[0].branch_id]);
      if (warehouse.rowCount !== 1) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Almacen invalido' }); }
      const items = await client.query(`SELECT poi.id,poi.ingredient_id,poi.quantity,poi.received_quantity,poi.unit_id,poi.unit_price,i.base_unit_id
        FROM purchase_order_items poi JOIN ingredients i ON i.id=poi.ingredient_id WHERE poi.purchase_order_id=$1 ORDER BY poi.id FOR UPDATE OF poi`, [orderId]);
      const itemById = new Map(items.rows.map((row: any) => [row.ingredient_id, row]));
      for (const item of input.data.items) {
        const line = itemById.get(item.ingredientId);
        if (!line) throw Object.assign(new Error('Ingrediente no incluido en la orden'), { statusCode: 400 });
        const remaining = Number(line.quantity) - Number(line.received_quantity);
        if (remaining <= 0) throw Object.assign(new Error('La linea ya fue recepcionada'), { statusCode: 409 });
        if (Number(item.quantityReceived) > remaining) throw Object.assign(new Error('La recepcion sobrepasa lo pedido'), { statusCode: 409 });
      }
      const receipt = await client.query('INSERT INTO purchase_receipts (company_id,branch_id,purchase_order_id,warehouse_id,received_by,notes,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [userOf(request).company_id, order.rows[0].branch_id, orderId, input.data.warehouseId, userOf(request).id, input.data.notes ?? null, input.data.idempotencyKey]);
      const movementReference = receipt.rows[0].id;
      for (const item of input.data.items) {
        const line = itemById.get(item.ingredientId)!;
        const baseDelta = line.unit_id === line.base_unit_id
          ? item.quantityReceived
          : trimmed(Number(convertQuantity(item.quantityReceived, (await conversionFactor(client, userOf(request).company_id, line.unit_id, line.base_unit_id))!)));
        await addMovement(client, { companyId: userOf(request).company_id, branchId: order.rows[0].branch_id, warehouseId: input.data.warehouseId, ingredientId: item.ingredientId, movementType: 'PURCHASE', quantity: item.quantityReceived, unitId: line.unit_id, reason: `Recepcion OC ${order.rows[0].folio}`, actorId: userOf(request).id, referenceId: movementReference, signedDelta: baseDelta });
        const receiptUnitPrice = item.unitPrice ?? line.unit_price;
        await client.query('UPDATE purchase_order_items SET received_quantity=received_quantity+$1 WHERE id=$2', [item.quantityReceived, line.id]);
        await client.query('INSERT INTO purchase_receipt_items (purchase_receipt_id,purchase_order_item_id,ingredient_id,quantity_received,unit_id,unit_price) VALUES ($1,$2,$3,$4,$5,$6)', [receipt.rows[0].id, line.id, item.ingredientId, item.quantityReceived, line.unit_id, receiptUnitPrice]);
        await client.query('INSERT INTO ingredient_costs (company_id,branch_id,ingredient_id,unit_id,unit_price,quantity_base,total_cost,source,purchase_receipt_id) VALUES ($1,$2,$3,$4,$5,$6,$7,\'PURCHASE\',$8)',
          [userOf(request).company_id, order.rows[0].branch_id, item.ingredientId, line.unit_id, receiptUnitPrice, baseDelta, Number((receiptUnitPrice * Number(item.quantityReceived)).toFixed(2)), receipt.rows[0].id]);
      }
      const refreshed = await client.query('SELECT count(*) FILTER (WHERE received_quantity >= quantity)::int full, count(*)::int total FROM purchase_order_items WHERE purchase_order_id=$1', [orderId]);
      const nextStatus = refreshed.rows[0].full >= refreshed.rows[0].total ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      await client.query("UPDATE purchase_orders SET status=$1, updated_at=now() WHERE id=$2", [nextStatus, orderId]);
      await audit(client, userOf(request), order.rows[0].branch_id, 'purchase_receipt', receipt.rows[0].id, 'purchase_receipt.created', `OC ${order.rows[0].folio}`);
      await client.query('COMMIT');
      return reply.code(201).send({ data: receipt.rows[0], status: nextStatus, idempotent: false });
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { statusCode?: number }).statusCode) return reply.code((error as { statusCode: number }).statusCode).send({ error: (error as Error).message });
      if ((error as Error).message.includes('negativa')) return reply.code(409).send({ error: (error as Error).message });
      throw error;
    } finally { client.release(); }
  });

  app.post('/api/v1/purchase-orders/:id/return', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'purchase.receive'))) return;
    const input = z.object({
      warehouseId: uuid, idempotencyKey: z.string().trim().min(8).max(120), notes: z.string().max(500).optional(),
      items: z.array(z.object({ ingredientId: uuid, quantityReturned: quantity })).min(1),
    }).safeParse(request.body);
    const orderId = (request.params as { id: string }).id;
    if (!input.success || !uuid.safeParse(orderId).success) return reply.code(400).send({ error: 'Devolucion invalida' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const prior = await client.query('SELECT * FROM purchase_returns WHERE idempotency_key=$1', [input.data.idempotencyKey]);
      if (prior.rowCount) { await client.query('ROLLBACK'); return { data: prior.rows[0], idempotent: true }; }
      const order = await client.query('SELECT * FROM purchase_orders WHERE id=$1 AND company_id=$2 FOR UPDATE', [orderId, userOf(request).company_id]);
      if (order.rowCount !== 1) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Orden de compra no encontrada' }); }
      if (!(await allowedBranch(request, order.rows[0].branch_id))) { await client.query('ROLLBACK'); return reply.code(403).send({ error: 'Sucursal no autorizada' }); }
      if (['DRAFT', 'CANCELLED'].includes(order.rows[0].status)) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'La orden no tiene recepciones para devolver' }); }
      const warehouse = await client.query('SELECT id FROM warehouses WHERE id=$1 AND company_id=$2 AND branch_id=$3 AND is_active', [input.data.warehouseId, userOf(request).company_id, order.rows[0].branch_id]);
      if (warehouse.rowCount !== 1) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Almacen invalido' }); }
      const items = await client.query(`SELECT poi.id,poi.ingredient_id,poi.quantity,poi.received_quantity,poi.unit_id,i.base_unit_id
        FROM purchase_order_items poi JOIN ingredients i ON i.id=poi.ingredient_id WHERE poi.purchase_order_id=$1 ORDER BY poi.id FOR UPDATE OF poi`, [orderId]);
      const itemById = new Map(items.rows.map((row: any) => [row.ingredient_id, row]));
      const returnedSoFar = await client.query(`SELECT pri.purchase_order_item_id, COALESCE(SUM(pri.quantity_returned),0) returned
        FROM purchase_return_items pri JOIN purchase_returns pr ON pr.id=pri.purchase_return_id
        WHERE pr.purchase_order_id=$1 GROUP BY pri.purchase_order_item_id`, [orderId]);
      const returnedMap = new Map(returnedSoFar.rows.map((row: any) => [row.purchase_order_item_id, Number(row.returned)]));
      for (const item of input.data.items) {
        const line = itemById.get(item.ingredientId);
        if (!line) throw Object.assign(new Error('Ingrediente no incluido en la orden'), { statusCode: 400 });
        const receivable = Number(line.received_quantity) - (returnedMap.get(line.id) ?? 0);
        if (Number(item.quantityReturned) > receivable) throw Object.assign(new Error('La devolucion sobrepasa lo recibido'), { statusCode: 409 });
      }
      const refund = await client.query('INSERT INTO purchase_returns (company_id,branch_id,purchase_order_id,warehouse_id,returned_by,notes,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [userOf(request).company_id, order.rows[0].branch_id, orderId, input.data.warehouseId, userOf(request).id, input.data.notes ?? null, input.data.idempotencyKey]);
      for (const item of input.data.items) {
        const line = itemById.get(item.ingredientId)!;
        const baseDelta = line.unit_id === line.base_unit_id
          ? item.quantityReturned
          : trimmed(Number(convertQuantity(item.quantityReturned, (await conversionFactor(client, userOf(request).company_id, line.unit_id, line.base_unit_id))!)));
        await addMovement(client, { companyId: userOf(request).company_id, branchId: order.rows[0].branch_id, warehouseId: input.data.warehouseId, ingredientId: item.ingredientId, movementType: 'RETURN', quantity: item.quantityReturned, unitId: line.unit_id, reason: `Devolucion OC ${order.rows[0].folio}`, actorId: userOf(request).id, referenceId: refund.rows[0].id, signedDelta: `-${baseDelta}` });
        await client.query('INSERT INTO purchase_return_items (purchase_return_id,purchase_order_item_id,ingredient_id,quantity_returned,unit_id) VALUES ($1,$2,$3,$4,$5)', [refund.rows[0].id, line.id, item.ingredientId, item.quantityReturned, line.unit_id]);
      }
      await audit(client, userOf(request), order.rows[0].branch_id, 'purchase_return', refund.rows[0].id, 'purchase_return.created', `OC ${order.rows[0].folio}`);
      await client.query('COMMIT');
      return reply.code(201).send({ data: refund.rows[0], idempotent: false });
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { statusCode?: number }).statusCode) return reply.code((error as { statusCode: number }).statusCode).send({ error: (error as Error).message });
      if ((error as Error).message.includes('negativa')) return reply.code(409).send({ error: (error as Error).message });
      throw error;
    } finally { client.release(); }
  });

  app.post('/api/v1/purchase-orders/:id/cancel', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'purchase.manage'))) return;
    const id = (request.params as { id: string }).id;
    if (!uuid.safeParse(id).success) return reply.code(400).send({ error: 'Orden de compra invalida' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const order = await client.query('SELECT * FROM purchase_orders WHERE id=$1 AND company_id=$2 FOR UPDATE', [id, userOf(request).company_id]);
      if (order.rowCount !== 1) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Orden de compra no encontrada' }); }
      if (!(await allowedBranch(request, order.rows[0].branch_id))) { await client.query('ROLLBACK'); return reply.code(403).send({ error: 'Sucursal no autorizada' }); }
      if (order.rows[0].status !== 'DRAFT') { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Solo se cancelan ordenes en borrador' }); }
      const updated = await client.query("UPDATE purchase_orders SET status='CANCELLED', updated_at=now() WHERE id=$1 RETURNING *", [id]);
      await audit(client, userOf(request), order.rows[0].branch_id, 'purchase_order', id, 'purchase_order.cancelled');
      await client.query('COMMIT');
      return { data: updated.rows[0] };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });
}