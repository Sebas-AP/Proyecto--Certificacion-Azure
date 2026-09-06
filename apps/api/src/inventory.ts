import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import { requireUser, userHasPermission } from './auth.js';
import { movementDelta, resultingQuantity, type InventoryMovementType } from './inventory-domain.js';

type User = { id: string; company_id: string };
const uuid = z.string().uuid();
const quantity = z.string().regex(/^\d+(\.\d{1,8})?$/).refine((value) => Number(value) > 0);
const userOf = (request: FastifyRequest) => request.user as User;

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

async function validWarehouse(client: { query: (text: string, values?: unknown[]) => Promise<{ rowCount: number; rows: any[] }> }, companyId: string, branchId: string, warehouseId: string): Promise<boolean> {
  const result = await client.query('SELECT 1 FROM warehouses WHERE id=$1 AND company_id=$2 AND branch_id=$3 AND is_active', [warehouseId, companyId, branchId]);
  return result.rowCount === 1;
}

export async function addMovement(client: { query: (text: string, values?: unknown[]) => Promise<{ rowCount: number; rows: any[] }> }, input: {
  companyId: string; branchId: string; warehouseId: string; ingredientId: string; movementType: InventoryMovementType;
  quantity: string; unitId: string; reason: string; actorId: string; referenceId?: string; signedDelta?: string; allowNegative?: boolean; idempotencyKey?: string;
}): Promise<any> {
  const ingredient = await client.query('SELECT id FROM ingredients WHERE id=$1 AND company_id=$2 AND is_active', [input.ingredientId, input.companyId]);
  if (ingredient.rowCount !== 1) throw Object.assign(new Error('Ingrediente no encontrado'), { statusCode: 404 });
  const unit = await client.query('SELECT id FROM units WHERE id=$1 AND (company_id=$2 OR company_id IS NULL) AND is_active', [input.unitId, input.companyId]);
  if (unit.rowCount !== 1) throw Object.assign(new Error('Unidad no encontrada'), { statusCode: 400 });
  await client.query(`INSERT INTO stock_balances (company_id,branch_id,warehouse_id,ingredient_id)
    VALUES ($1,$2,$3,$4) ON CONFLICT (warehouse_id,ingredient_id) DO NOTHING`, [input.companyId, input.branchId, input.warehouseId, input.ingredientId]);
  const balance = await client.query('SELECT id, quantity FROM stock_balances WHERE warehouse_id=$1 AND ingredient_id=$2 FOR UPDATE', [input.warehouseId, input.ingredientId]);
  if (balance.rowCount !== 1) throw Object.assign(new Error('Balance no encontrado'), { statusCode: 404 });
  const delta = input.signedDelta ?? movementDelta(input.movementType, input.quantity);
  const next = resultingQuantity(String(balance.rows[0].quantity), delta, input.allowNegative === true);
  await client.query('UPDATE stock_balances SET quantity=$1, updated_at=now() WHERE id=$2', [next, balance.rows[0].id]);
  const movement = await client.query(`INSERT INTO stock_movements
    (company_id,branch_id,warehouse_id,ingredient_id,movement_type,quantity,unit_id,reason,reference_id,idempotency_key,created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
  [input.companyId, input.branchId, input.warehouseId, input.ingredientId, input.movementType, input.quantity, input.unitId, input.reason, input.referenceId ?? null, input.idempotencyKey ?? null, input.actorId]);
  return movement.rows[0];
}

async function audit(client: { query: (text: string, values?: unknown[]) => Promise<unknown> }, user: User, branchId: string | null, entityType: string, entityId: string, action: string, reason?: string): Promise<void> {
  await client.query(`INSERT INTO audit_logs (company_id,branch_id,actor_id,entity_type,entity_id,action,reason)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`, [user.company_id, branchId, user.id, entityType, entityId, action, reason ?? null]);
}

export async function registerInventoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/units', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'inventory.read'))) return;
    const result = await pool.query('SELECT id,company_id,code,name,is_active FROM units WHERE is_active AND (company_id=$1 OR company_id IS NULL) ORDER BY company_id IS NOT NULL,code', [userOf(request).company_id]);
    return { data: result.rows };
  });
  app.get('/api/v1/unit-conversions', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'inventory.read'))) return;
    const result = await pool.query(`SELECT uc.id,uc.from_unit_id,fu.code from_unit_code,uc.to_unit_id,tu.code to_unit_code,uc.factor
      FROM unit_conversions uc JOIN units fu ON fu.id=uc.from_unit_id JOIN units tu ON tu.id=uc.to_unit_id
      WHERE uc.company_id=$1 OR uc.company_id IS NULL ORDER BY fu.code,tu.code`, [userOf(request).company_id]);
    return { data: result.rows };
  });
  app.post('/api/v1/unit-conversions', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'inventory.manage'))) return;
    const input = z.object({ fromUnitId: uuid, toUnitId: uuid, factor: z.number().positive() }).safeParse(request.body);
    if (!input.success || input.data.fromUnitId === input.data.toUnitId) return reply.code(400).send({ error: 'Conversion invalida' });
    const units = await pool.query('SELECT id FROM units WHERE id=ANY($1::uuid[]) AND is_active', [[input.data.fromUnitId, input.data.toUnitId]]);
    if (units.rowCount !== 2) return reply.code(400).send({ error: 'Unidad inexistente' });
    try {
      const result = await pool.query('INSERT INTO unit_conversions (company_id,from_unit_id,to_unit_id,factor) VALUES ($1,$2,$3,$4) RETURNING *', [userOf(request).company_id, input.data.fromUnitId, input.data.toUnitId, input.data.factor]);
      return reply.code(201).send({ data: result.rows[0] });
    } catch (error) { if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'La conversion ya existe' }); throw error; }
  });
  app.get('/api/v1/ingredients', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'inventory.read'))) return;
    const result = await pool.query(`SELECT i.id,i.name,i.sku,i.base_unit_id, u.code base_unit_code,i.is_active
      FROM ingredients i JOIN units u ON u.id=i.base_unit_id WHERE i.company_id=$1 ORDER BY i.name`, [userOf(request).company_id]);
    return { data: result.rows };
  });
  app.post('/api/v1/ingredients', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'inventory.manage'))) return;
    const input = z.object({ name: z.string().trim().min(1).max(160), sku: z.string().trim().max(80).optional(), baseUnitId: uuid }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Ingrediente invalido' });
    try {
      const result = await pool.query(`INSERT INTO ingredients (company_id,name,sku,base_unit_id)
        SELECT $1,$2,$3,id FROM units WHERE id=$4 AND (company_id=$1 OR company_id IS NULL) AND is_active RETURNING *`, [userOf(request).company_id, input.data.name, input.data.sku ?? null, input.data.baseUnitId]);
      if (result.rowCount !== 1) return reply.code(400).send({ error: 'Unidad no encontrada' });
      return reply.code(201).send({ data: result.rows[0] });
    } catch (error) { if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'El ingrediente ya existe' }); throw error; }
  });
  app.get('/api/v1/warehouses', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'inventory.read'))) return;
    const branchId = (request.query as { branchId?: string }).branchId;
    if (!branchId || !uuid.safeParse(branchId).success || !(await allowedBranch(request, branchId))) return reply.code(403).send({ error: 'Sucursal no autorizada' });
    return { data: (await pool.query('SELECT id,branch_id,name,is_active FROM warehouses WHERE company_id=$1 AND branch_id=$2 ORDER BY name', [userOf(request).company_id, branchId])).rows };
  });
  app.post('/api/v1/warehouses', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'inventory.manage'))) return;
    const input = z.object({ branchId: uuid, name: z.string().trim().min(1).max(120) }).safeParse(request.body);
    if (!input.success || !(await allowedBranch(request, input.success ? input.data.branchId : ''))) return reply.code(400).send({ error: 'Almacen invalido' });
    try { const result = await pool.query('INSERT INTO warehouses (company_id,branch_id,name) VALUES ($1,$2,$3) RETURNING *', [userOf(request).company_id, input.data.branchId, input.data.name]); return reply.code(201).send({ data: result.rows[0] }); }
    catch (error) { if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'El almacen ya existe' }); throw error; }
  });
  app.get('/api/v1/inventory/balances', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'inventory.read'))) return;
    const branchId = (request.query as { branchId?: string }).branchId;
    if (!branchId || !uuid.safeParse(branchId).success || !(await allowedBranch(request, branchId))) return reply.code(403).send({ error: 'Sucursal no autorizada' });
    const result = await pool.query(`SELECT w.id warehouse_id,w.name warehouse_name,i.id ingredient_id,i.name ingredient_name,
      COALESCE(sb.quantity,0) quantity,u.code unit_code,sb.updated_at FROM warehouses w CROSS JOIN ingredients i
      JOIN units u ON u.id=i.base_unit_id LEFT JOIN stock_balances sb ON sb.warehouse_id=w.id AND sb.ingredient_id=i.id AND sb.company_id=$1 AND sb.branch_id=$2
      WHERE w.company_id=$1 AND w.branch_id=$2 ORDER BY w.name,i.name`, [userOf(request).company_id, branchId]);
    return { data: result.rows };
  });
  app.get('/api/v1/inventory/movements', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'inventory.read'))) return;
    const query = request.query as { branchId?: string; ingredientId?: string };
    if (!query.branchId || !uuid.safeParse(query.branchId).success || !(await allowedBranch(request, query.branchId))) return reply.code(403).send({ error: 'Sucursal no autorizada' });
    if (query.ingredientId && !uuid.safeParse(query.ingredientId).success) return reply.code(400).send({ error: 'Ingrediente invalido' });
    const result = await pool.query(`SELECT sm.*,i.name ingredient_name,w.name warehouse_name,u.code unit_code FROM stock_movements sm
      JOIN ingredients i ON i.id=sm.ingredient_id JOIN warehouses w ON w.id=sm.warehouse_id JOIN units u ON u.id=sm.unit_id
      WHERE sm.company_id=$1 AND sm.branch_id=$2 AND ($3::uuid IS NULL OR sm.ingredient_id=$3) ORDER BY sm.created_at DESC`, [userOf(request).company_id, query.branchId, query.ingredientId ?? null]);
    return { data: result.rows };
  });
  app.post('/api/v1/inventory/adjustments', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'inventory.adjust'))) return;
    return createMovementRoute(request, reply, ['POSITIVE_ADJUSTMENT', 'NEGATIVE_ADJUSTMENT', 'PURCHASE']);
  });
  app.post('/api/v1/inventory/waste', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'inventory.adjust'))) return;
    const input = z.object({ branchId: uuid, warehouseId: uuid, ingredientId: uuid, quantity, unitId: uuid, reason: z.string().trim().min(1).max(500) }).safeParse(request.body);
    if (!input.success || !(await allowedBranch(request, input.success ? input.data.branchId : ''))) return reply.code(400).send({ error: 'Merma invalida' });
    const client = await pool.connect();
    try { await client.query('BEGIN'); if (!(await validWarehouse(client, userOf(request).company_id, input.data.branchId, input.data.warehouseId))) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Almacen invalido' }); }
      const movement = await addMovement(client, { companyId: userOf(request).company_id, branchId: input.data.branchId, warehouseId: input.data.warehouseId, ingredientId: input.data.ingredientId, movementType: 'WASTE', quantity: input.data.quantity, unitId: input.data.unitId, reason: input.data.reason, actorId: userOf(request).id });
      const waste = await client.query(`INSERT INTO waste_records (company_id,branch_id,warehouse_id,ingredient_id,quantity,unit_id,reason,movement_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [userOf(request).company_id, input.data.branchId, input.data.warehouseId, input.data.ingredientId, input.data.quantity, input.data.unitId, input.data.reason, movement.id, userOf(request).id]);
      await audit(client, userOf(request), input.data.branchId, 'waste_record', waste.rows[0].id, 'waste.created', input.data.reason); await client.query('COMMIT'); return reply.code(201).send({ data: waste.rows[0], movement });
    } catch (error) { await client.query('ROLLBACK'); if ((error as { statusCode?: number }).statusCode) return reply.code((error as { statusCode: number }).statusCode).send({ error: (error as Error).message }); if ((error as Error).message.includes('negativa')) return reply.code(409).send({ error: (error as Error).message }); throw error; } finally { client.release(); }
  });
  app.post('/api/v1/inventory/transfers', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'inventory.adjust'))) return;
    const input = z.object({ branchId: uuid, fromWarehouseId: uuid, toWarehouseId: uuid, ingredientId: uuid, quantity, unitId: uuid, reason: z.string().trim().min(1).max(500), idempotencyKey: z.string().trim().min(8).max(120) }).safeParse(request.body);
    if (!input.success || !(await allowedBranch(request, input.success ? input.data.branchId : ''))) return reply.code(400).send({ error: 'Transferencia invalida' });
    if (input.data.fromWarehouseId === input.data.toWarehouseId) return reply.code(400).send({ error: 'Los almacenes deben ser distintos' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const prior = await client.query(`SELECT id FROM stock_movements WHERE idempotency_key=$1 AND movement_type='TRANSFER_OUT'`, [input.data.idempotencyKey]);
      if (prior.rowCount) {
        const priorData = await client.query('SELECT * FROM stock_movements WHERE idempotency_key=$1 ORDER BY created_at', [input.data.idempotencyKey]);
        await client.query('ROLLBACK');
        return { data: priorData.rows, idempotent: true };
      }
      const from = await client.query('SELECT id FROM warehouses WHERE id=$1 AND company_id=$2 AND branch_id=$3 AND is_active', [input.data.fromWarehouseId, userOf(request).company_id, input.data.branchId]);
      const to = await client.query('SELECT id FROM warehouses WHERE id=$1 AND company_id=$2 AND branch_id=$3 AND is_active', [input.data.toWarehouseId, userOf(request).company_id, input.data.branchId]);
      if (from.rowCount !== 1 || to.rowCount !== 1) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Almacen origen o destino invalido' }); }
      const referenceId = crypto.randomUUID();
      const transferOut = await addMovement(client, { companyId: userOf(request).company_id, branchId: input.data.branchId, warehouseId: input.data.fromWarehouseId, ingredientId: input.data.ingredientId, movementType: 'TRANSFER_OUT', quantity: input.data.quantity, unitId: input.data.unitId, reason: input.data.reason, actorId: userOf(request).id, referenceId, idempotencyKey: input.data.idempotencyKey });
      const transferIn = await addMovement(client, { companyId: userOf(request).company_id, branchId: input.data.branchId, warehouseId: input.data.toWarehouseId, ingredientId: input.data.ingredientId, movementType: 'TRANSFER_IN', quantity: input.data.quantity, unitId: input.data.unitId, reason: input.data.reason, actorId: userOf(request).id, referenceId, idempotencyKey: input.data.idempotencyKey });
      await client.query('COMMIT');
      return reply.code(201).send({ data: { transfer_out: transferOut, transfer_in: transferIn }, idempotent: false });
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') {
        const prior = await pool.query('SELECT * FROM stock_movements WHERE idempotency_key=$1 ORDER BY created_at', [input.data.idempotencyKey]);
        if (prior.rowCount) return { data: prior.rows, idempotent: true };
      }
      if ((error as { statusCode?: number }).statusCode) return reply.code((error as { statusCode: number }).statusCode).send({ error: (error as Error).message });
      if ((error as Error).message.includes('negativa')) return reply.code(409).send({ error: (error as Error).message });
      throw error;
    } finally { client.release(); }
  });
  app.get('/api/v1/recipes', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'recipe.read'))) return;
    const result = await pool.query(`SELECT r.*,COALESCE(json_agg(json_build_object('id',rv.id,'version',rv.version,'notes',rv.notes,'created_at',rv.created_at) ORDER BY rv.version DESC) FILTER (WHERE rv.id IS NOT NULL),'[]') versions
      FROM recipes r LEFT JOIN recipe_versions rv ON rv.recipe_id=r.id WHERE r.company_id=$1 GROUP BY r.id ORDER BY r.name`, [userOf(request).company_id]); return { data: result.rows };
  });
  app.post('/api/v1/recipes', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'recipe.manage'))) return;
    const input = recipeInput.safeParse(request.body); if (!input.success || (input.data.branchId && !(await allowedBranch(request, input.data.branchId)))) return reply.code(400).send({ error: 'Receta invalida' });
    return createRecipe(request, reply, input.data);
  });
  app.get('/api/v1/recipe-versions/:id', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'recipe.read'))) return;
    const versionId = (request.params as { id: string }).id;
    if (!uuid.safeParse(versionId).success) return reply.code(400).send({ error: 'Version de receta invalida' });
    const version = await pool.query(`SELECT rv.id,rv.recipe_id,r.name recipe_name,rv.version,rv.notes,rv.created_at FROM recipe_versions rv
      JOIN recipes r ON r.id=rv.recipe_id WHERE rv.id=$1 AND r.company_id=$2`, [versionId, userOf(request).company_id]);
    if (version.rowCount !== 1) return reply.code(404).send({ error: 'Version de receta no encontrada' });
    const items = await pool.query(`SELECT ri.ingredient_id,i.name ingredient_name,ri.quantity,ri.unit_id,u.code unit_code
      FROM recipe_items ri JOIN ingredients i ON i.id=ri.ingredient_id JOIN units u ON u.id=ri.unit_id
      WHERE ri.recipe_version_id=$1 ORDER BY i.name`, [versionId]);
    return { data: { ...version.rows[0], items: items.rows } };
  });
  app.post('/api/v1/recipes/:id/versions', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'recipe.manage'))) return;
    const input = versionInput.safeParse(request.body); if (!input.success) return reply.code(400).send({ error: 'Version de receta invalida' });
    return createVersion(request, reply, (request.params as { id: string }).id, input.data);
  });
  app.post('/api/v1/inventory/counts', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'inventory.adjust'))) return;
    const input = z.object({ branchId: uuid, warehouseId: uuid, notes: z.string().max(500).optional() }).safeParse(request.body);
    if (!input.success || !(await allowedBranch(request, input.success ? input.data.branchId : ''))) return reply.code(400).send({ error: 'Conteo invalido' });
    if (!(await validWarehouse(pool, userOf(request).company_id, input.data.branchId, input.data.warehouseId))) return reply.code(400).send({ error: 'Almacen invalido' });
    const result = await pool.query('INSERT INTO stock_counts (company_id,branch_id,warehouse_id,notes,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *', [userOf(request).company_id, input.data.branchId, input.data.warehouseId, input.data.notes ?? null, userOf(request).id]); return reply.code(201).send({ data: result.rows[0] });
  });
  app.post('/api/v1/inventory/counts/:id/result', { preHandler: requireUser }, async (request, reply) => {
    if (!(await permission(request, reply, 'inventory.adjust'))) return;
    const input = z.object({ items: z.array(z.object({ ingredientId: uuid, countedQuantity: z.string().regex(/^\d+(\.\d{1,8})?$/), unitId: uuid })).min(1) }).safeParse(request.body); if (!input.success) return reply.code(400).send({ error: 'Resultado de conteo invalido' });
    return completeCount(request, reply, (request.params as { id: string }).id, input.data.items);
  });
}

async function createMovementRoute(request: FastifyRequest, reply: FastifyReply, allowedTypes: string[]) {
  const input = z.object({ branchId: uuid, warehouseId: uuid, ingredientId: uuid, quantity, unitId: uuid, type: z.enum(['POSITIVE_ADJUSTMENT', 'NEGATIVE_ADJUSTMENT', 'PURCHASE']), reason: z.string().trim().min(1).max(500) }).safeParse(request.body);
  if (!input.success || !allowedTypes.includes(input.success ? input.data.type : '') || !(await allowedBranch(request, input.success ? input.data.branchId : ''))) return reply.code(400).send({ error: 'Ajuste invalido' });
  const client = await pool.connect(); try { await client.query('BEGIN'); if (!(await validWarehouse(client, userOf(request).company_id, input.data.branchId, input.data.warehouseId))) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'Almacen invalido' }); }
    const movement = await addMovement(client, { companyId: userOf(request).company_id, branchId: input.data.branchId, warehouseId: input.data.warehouseId, ingredientId: input.data.ingredientId, movementType: input.data.type, quantity: input.data.quantity, unitId: input.data.unitId, reason: input.data.reason, actorId: userOf(request).id });
    await audit(client, userOf(request), input.data.branchId, 'stock_movement', movement.id, 'inventory.adjustment.created', input.data.reason); await client.query('COMMIT'); return reply.code(201).send({ data: movement });
  } catch (error) { await client.query('ROLLBACK'); if ((error as { statusCode?: number }).statusCode) return reply.code((error as { statusCode: number }).statusCode).send({ error: (error as Error).message }); if ((error as Error).message.includes('negativa')) return reply.code(409).send({ error: (error as Error).message }); throw error; } finally { client.release(); }
}

const recipeItem = z.object({ ingredientId: uuid, quantity, unitId: uuid });
const versionInput = z.object({ notes: z.string().max(500).optional(), items: z.array(recipeItem).min(1) });
const recipeInput = z.object({ name: z.string().trim().min(1).max(160), branchId: uuid.optional(), productId: uuid.optional(), notes: z.string().max(500).optional(), items: z.array(recipeItem).min(1) });
type VersionInput = z.infer<typeof versionInput>;

async function createRecipe(request: FastifyRequest, reply: FastifyReply, input: z.infer<typeof recipeInput>) {
  const client = await pool.connect(); try { await client.query('BEGIN'); const recipe = await client.query('INSERT INTO recipes (company_id,branch_id,product_id,name) VALUES ($1,$2,$3,$4) RETURNING *', [userOf(request).company_id, input.branchId ?? null, input.productId ?? null, input.name]); const version = await insertVersion(client, recipe.rows[0].id, input.notes, input.items, userOf(request).id); await audit(client, userOf(request), input.branchId ?? null as unknown as string, 'recipe', recipe.rows[0].id, 'recipe.created'); await client.query('COMMIT'); return reply.code(201).send({ data: recipe.rows[0], version }); } catch (error) { await client.query('ROLLBACK'); if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'La receta ya existe' }); throw error; } finally { client.release(); }
}

async function createVersion(request: FastifyRequest, reply: FastifyReply, recipeId: string, input: VersionInput) {
  const client = await pool.connect(); try { await client.query('BEGIN'); const recipe = await client.query('SELECT id,branch_id FROM recipes WHERE id=$1 AND company_id=$2 FOR UPDATE', [recipeId, userOf(request).company_id]); if (recipe.rowCount !== 1) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Receta no encontrada' }); } const version = await insertVersion(client, recipeId, input.notes, input.items, userOf(request).id); await audit(client, userOf(request), recipe.rows[0].branch_id, 'recipe', recipeId, 'recipe.version.created'); await client.query('COMMIT'); return reply.code(201).send({ data: version }); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function insertVersion(client: { query: (text: string, values?: unknown[]) => Promise<{ rowCount: number; rows: any[] }> }, recipeId: string, notes: string | undefined, items: Array<{ ingredientId: string; quantity: string; unitId: string }>, actorId: string) {
  const recipe = await client.query('SELECT company_id FROM recipes WHERE id=$1', [recipeId]);
  for (const item of items) {
    const valid = await client.query(`SELECT 1 FROM ingredients i JOIN units u ON u.id=$3
      WHERE i.id=$1 AND i.company_id=$2 AND i.is_active AND (u.company_id=$2 OR u.company_id IS NULL) AND u.is_active`, [item.ingredientId, recipe.rows[0].company_id, item.unitId]);
    if (valid.rowCount !== 1) throw Object.assign(new Error('Ingrediente o unidad fuera de la empresa'), { statusCode: 400 });
  }
  const current = await client.query('SELECT COALESCE(MAX(version),0)+1 version FROM recipe_versions WHERE recipe_id=$1', [recipeId]); const version = await client.query('INSERT INTO recipe_versions (recipe_id,version,notes,created_by) VALUES ($1,$2,$3,$4) RETURNING *', [recipeId, current.rows[0].version, notes ?? null, actorId]); for (const item of items) await client.query('INSERT INTO recipe_items (recipe_version_id,ingredient_id,quantity,unit_id) VALUES ($1,$2,$3,$4)', [version.rows[0].id, item.ingredientId, item.quantity, item.unitId]); return { ...version.rows[0], items };
}

async function completeCount(request: FastifyRequest, reply: FastifyReply, countId: string, items: Array<{ ingredientId: string; countedQuantity: string; unitId: string }>) {
  const client = await pool.connect(); try { await client.query('BEGIN'); const count = await client.query('SELECT * FROM stock_counts WHERE id=$1 AND company_id=$2 AND status=\'OPEN\' FOR UPDATE', [countId, userOf(request).company_id]); if (count.rowCount !== 1) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Conteo abierto no encontrado' }); } if (!(await allowedBranch(request, count.rows[0].branch_id))) { await client.query('ROLLBACK'); return reply.code(403).send({ error: 'Sucursal no autorizada' }); }
    for (const item of items) {
      const member = await client.query(`SELECT 1 FROM ingredients i JOIN units u ON u.id=$3
        WHERE i.id=$1 AND i.company_id=$2 AND i.is_active AND (u.company_id=$2 OR u.company_id IS NULL) AND u.is_active`,
      [item.ingredientId, userOf(request).company_id, item.unitId]);
      if (member.rowCount !== 1) throw Object.assign(new Error('Ingrediente o unidad fuera de la empresa'), { statusCode: 400 });
      await client.query('INSERT INTO stock_count_items (stock_count_id,ingredient_id,expected_quantity,counted_quantity,unit_id) SELECT $1,$2,COALESCE((SELECT quantity FROM stock_balances WHERE warehouse_id=$3 AND ingredient_id=$2),0),$4,$5', [countId, item.ingredientId, count.rows[0].warehouse_id, item.countedQuantity, item.unitId]); const balance = await client.query('SELECT quantity FROM stock_balances WHERE warehouse_id=$1 AND ingredient_id=$2 FOR UPDATE', [count.rows[0].warehouse_id, item.ingredientId]); const current = Number(balance.rows[0]?.quantity ?? 0); const delta = Number(item.countedQuantity) - current; if (delta !== 0) await addMovement(client, { companyId: userOf(request).company_id, branchId: count.rows[0].branch_id, warehouseId: count.rows[0].warehouse_id, ingredientId: item.ingredientId, movementType: 'COUNT', quantity: Math.abs(delta).toFixed(8), unitId: item.unitId, reason: 'Resultado de conteo', actorId: userOf(request).id, referenceId: countId, signedDelta: delta.toFixed(8) }); }
    await client.query("UPDATE stock_counts SET status='COMPLETED',completed_at=now() WHERE id=$1", [countId]); await audit(client, userOf(request), count.rows[0].branch_id, 'stock_count', countId, 'stock_count.completed'); await client.query('COMMIT'); return { data: { id: countId, status: 'COMPLETED' } };
  } catch (error) { await client.query('ROLLBACK'); if ((error as Error).message.includes('negativa')) return reply.code(409).send({ error: (error as Error).message }); throw error; } finally { client.release(); }
}