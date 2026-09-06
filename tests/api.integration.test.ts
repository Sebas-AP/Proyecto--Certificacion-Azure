import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, seedTestEnvironment, cleanupTestEnvironment, purgeTestEnvironments, closePool, type TestEnvironment } from './support.js';
import { pool } from '../apps/api/src/db.js';

const { buildApp } = await import('../apps/api/src/app.js');

let app: Awaited<ReturnType<typeof buildApp>>;
let env: TestEnvironment;
let adminCookie: string;
let cookieBody = '';

type InjectResult = { status: number; json: any; headers: import('node:http').OutgoingHttpHeaders };

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function call(cookie: string, method: HttpMethod, url: string, body?: unknown): Promise<InjectResult> {
  const headers: Record<string, string> = { cookie };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.inject({ method, url, headers, payload: body === undefined ? undefined : JSON.stringify(body) });
  let json: any = {};
  try { json = JSON.parse(res.body); } catch { /* sin cuerpo JSON */ }
  const setCookie = res.headers['set-cookie'];
  if (setCookie) cookieBody = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
  return { status: res.statusCode, json, headers: res.headers };
}

async function login(email: string, password: string): Promise<string> {
  await call('', 'POST', '/api/v1/auth/login', { email, password });
  return cookieBody;
}

async function createOrder(): Promise<{ id: string; cookie: string }> {
  const key = `integration-${crypto.randomUUID()}`;
  const created = await call(adminCookie, 'POST', '/api/v1/orders', { branchId: env.branchId, tableId: env.tableId, channel: 'DINE_IN', idempotencyKey: key });
  const id = created.json.data.id;
  const item = await call(adminCookie, 'POST', `/api/v1/orders/${id}/items`, { productId: env.productId, variantId: env.variantId, quantity: 1 });
  if (item.status !== 201) throw new Error(`No se pudo agregar item al pedido: ${item.status} ${JSON.stringify(item.json)}`);
  return { id, cookie: adminCookie };
}

beforeAll(async () => {
  await migrate();
  await purgeTestEnvironments();
  env = await seedTestEnvironment();
  app = await buildApp({ logger: false });
  adminCookie = await login(env.email, env.password);
  expect(adminCookie).toMatch(/^session=/);
});

afterAll(async () => {
  await cleanupTestEnvironment(env.companyId);
  await app.close();
  await closePool();
});

describe('autenticacion y sesion', () => {
  it('rechaza credenciales invalidas', async () => {
    const res = await call('', 'POST', '/api/v1/auth/login', { email: env.email, password: 'incorrecta' });
    expect(res.status).toBe(401);
  });

  it('inicia sesion y consulta el perfil', async () => {
    const me = await call(adminCookie, 'GET', '/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.json.user.email).toBe(env.email);
  });

  it('rechaza solicitudes sin sesion', async () => {
    const res = await call('', 'GET', '/api/v1/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('catalogo y contexto', () => {
  it('lista sucursales de la empresa', async () => {
    const res = await call(adminCookie, 'GET', '/api/v1/branches');
    expect(res.status).toBe(200);
    expect(res.json.data.some((b: { id: string }) => b.id === env.branchId)).toBe(true);
  });

  it('expone el menu con precios vigentes', async () => {
    const res = await call(adminCookie, 'GET', `/api/v1/branches/${env.branchId}/menu`);
    expect(res.status).toBe(200);
    const product = res.json.data.find((p: { id: string }) => p.id === env.productId);
    expect(product).toBeDefined();
    expect(product.variants.some((v: { name: string; price: number }) => v.name === 'Sencilla' && Number(v.price) === 35)).toBe(true);
  });

  it('lista mesas de la sucursal', async () => {
    const res = await call(adminCookie, 'GET', `/api/v1/branches/${env.branchId}/tables`);
    expect(res.status).toBe(200);
    expect(res.json.data.some((t: { id: string }) => t.id === env.tableId)).toBe(true);
  });
});

describe('flujo de pedidos (E2E desde la PWA)', () => {
  it('crea, confirma con cuerpo vacio y envia a cocina', async () => {
    const key = `integration-e2e-${crypto.randomUUID()}`;
    const created = await call(adminCookie, 'POST', '/api/v1/orders', { branchId: env.branchId, tableId: env.tableId, channel: 'DINE_IN', idempotencyKey: key });
    expect(created.status).toBe(201);
    expect(created.json.data.status).toBe('DRAFT');
    const id = created.json.data.id;

    const repeated = await call(adminCookie, 'POST', '/api/v1/orders', { branchId: env.branchId, tableId: env.tableId, channel: 'DINE_IN', idempotencyKey: key });
    expect(repeated.status).toBe(200);
    expect(repeated.json.idempotent).toBe(true);

    const item = await call(adminCookie, 'POST', `/api/v1/orders/${id}/items`, { productId: env.productId, variantId: env.variantId, quantity: 2 });
    expect(item.status).toBe(201);

    const confirm = await call(adminCookie, 'POST', `/api/v1/orders/${id}/confirm`, {});
    expect(confirm.status).toBe(200);
    expect(confirm.json.data.status).toBe('CONFIRMED');
    expect(Number(confirm.json.data.total)).toBe(70);

    const kitchen = await call(adminCookie, 'POST', `/api/v1/orders/${id}/send-to-kitchen`, { idempotencyKey: `${key}-kitchen` });
    expect(kitchen.status).toBe(200);
    expect(kitchen.json.data.kitchen_status).toBe('PENDING');

    const detail = await call(adminCookie, 'GET', `/api/v1/orders/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.json.items).toHaveLength(1);
    expect(detail.json.items[0].quantity).toBe(2);
  });

  it('responde 400 a JSON malformado en lugar de 500', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/orders', headers: { cookie: adminCookie, 'content-type': 'application/json' }, payload: '{ no es json' });
    expect(res.statusCode).toBe(400);
  });
});

describe('cocina', () => {
  it('inicia y marca lista la comanda con idempotencia', async () => {
    const { id } = await createOrder();
    await call(adminCookie, 'POST', `/api/v1/orders/${id}/confirm`, {});
    const sent = await call(adminCookie, 'POST', `/api/v1/orders/${id}/send-to-kitchen`, { idempotencyKey: `kitchen-key-${crypto.randomUUID()}` });
    expect(sent.status).toBe(200);

    const before = await call(adminCookie, 'GET', `/api/v1/branches/${env.branchId}/kitchen/orders`);
    expect(before.json.data.some((o: { id: string }) => o.id === id)).toBe(true);

    const start = await call(adminCookie, 'POST', `/api/v1/kitchen/orders/${id}/start`, { idempotencyKey: `start-key-${crypto.randomUUID()}` });
    expect(start.status).toBe(200);
    expect(start.json.data.kitchen_status).toBe('IN_PROGRESS');

    const doubleStart = await call(adminCookie, 'POST', `/api/v1/kitchen/orders/${id}/start`, { idempotencyKey: `start-key-2-${crypto.randomUUID()}` });
    expect(doubleStart.status).toBe(409);

    const ready = await call(adminCookie, 'POST', `/api/v1/kitchen/orders/${id}/ready`, { idempotencyKey: `ready-key-${crypto.randomUUID()}` });
    expect(ready.status).toBe(200);
    expect(ready.json.data.kitchen_status).toBe('READY');
  });
});

describe('caja y pagos', () => {
  it('abre sesion, cobra, consulta pagos y cierra con diferencia calculada', async () => {
    const opened = await call(adminCookie, 'POST', `/api/v1/branches/${env.branchId}/cash-sessions/open`, { openingCash: 500 });
    expect(opened.status).toBe(201);

    const duplicateOpen = await call(adminCookie, 'POST', `/api/v1/branches/${env.branchId}/cash-sessions/open`, { openingCash: 500 });
    expect(duplicateOpen.status).toBe(409);

    const current = await call(adminCookie, 'GET', `/api/v1/branches/${env.branchId}/cash-sessions/current`);
    expect(current.json.data.status).toBe('OPEN');
    const sessionId = current.json.data.id;

    const { id: orderId } = await createOrder();
    await call(adminCookie, 'POST', `/api/v1/orders/${orderId}/confirm`, {});
    const payment = await call(adminCookie, 'POST', `/api/v1/orders/${orderId}/payments`, { method: 'CASH', amount: 35, cashReceived: 50, idempotencyKey: `pay-cash-${crypto.randomUUID()}` });
    expect(payment.status).toBe(201);
    expect(Number(payment.json.data.change_amount)).toBe(15);
    expect(Number(payment.json.data.amount)).toBe(35);

    const completed = await call(adminCookie, 'GET', `/api/v1/orders/${orderId}`);
    expect(completed.json.data.status).toBe('COMPLETED');

    const rejected = await call(adminCookie, 'POST', `/api/v1/orders/${orderId}/payments`, { method: 'CARD', amount: 5, idempotencyKey: `pay-extra-${crypto.randomUUID()}` });
    expect(rejected.status).toBe(409);

    const payments = await call(adminCookie, 'GET', `/api/v1/orders/${orderId}/payments`);
    expect(payments.status).toBe(200);
    expect(payments.json.data).toHaveLength(1);
    expect(Number(payments.json.data[0].amount)).toBe(35);

    const movement = await call(adminCookie, 'POST', `/api/v1/cash-sessions/${sessionId}/movements`, { movementType: 'OUT', amount: 100, reason: 'Compra de insumos' });
    expect(movement.status).toBe(201);

    const expected = 500 - 15 + 35 - 100;
    const closed = await call(adminCookie, 'POST', `/api/v1/cash-sessions/${sessionId}/close`, { countedCash: expected });
    expect(closed.status).toBe(200);
    expect(Number(closed.json.data.difference)).toBe(0);
    expect(closed.json.data.status).toBe('CLOSED');
  });
});

describe('reportes', () => {
  it('reporta la venta completada y la operacion', async () => {
    const today = new Date();
    const from = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
    const to = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);

    const sales = await call(adminCookie, 'GET', `/api/v1/reports/sales-summary?dateFrom=${from}&dateTo=${to}&branchId=${env.branchId}`);
    expect(sales.status).toBe(200);
    expect(Number(sales.json.data.salesTotal)).toBeGreaterThanOrEqual(35);
    expect(Number(sales.json.data.paidOrders)).toBeGreaterThanOrEqual(1);
    expect(Number(sales.json.data.salesByPaymentMethod.CASH)).toBeGreaterThanOrEqual(35);

    const operations = await call(adminCookie, 'GET', `/api/v1/reports/operations-summary?dateFrom=${from}&dateTo=${to}&branchId=${env.branchId}`);
    expect(operations.status).toBe(200);
    expect(Number(operations.json.data.open_orders)).toBeGreaterThanOrEqual(0);
  });
});

describe('aislamiento entre sucursales y permisos', () => {
  it('niega acceso del usuario limitado a la sucursal no asignada', async () => {
    const limited = await login('limitado@prueba.local', env.password);
    expect(limited).toMatch(/^session=/);

    const menu = await call(limited, 'GET', `/api/v1/branches/${env.branchId}/menu`);
    expect(menu.status).toBe(403);

    const kitchen = await call(limited, 'GET', `/api/v1/branches/${env.branchId}/kitchen/orders`);
    expect(kitchen.status).toBe(403);

    const cash = await call(limited, 'GET', `/api/v1/branches/${env.branchId}/cash-sessions/current`);
    expect(cash.status).toBe(403);
  });

  it('no expone pagos de pedidos de otra sucursal', async () => {
    const { id } = await createOrder();
    const limited = await login('limitado@prueba.local', env.password);
    const res = await call(limited, 'GET', `/api/v1/orders/${id}/payments`);
    expect(res.status).toBe(404);
  });
});

describe('inventario', () => {
  let ingredientId: string;
  let warehouseId: string;

  it('lista las unidades globales y de la empresa', async () => {
    const units = await call(adminCookie, 'GET', '/api/v1/units');
    expect(units.status).toBe(200);
    const codes = units.json.data.map((u: { code: string }) => u.code);
    for (const expected of ['KG', 'G', 'L', 'ML', 'UNIT']) expect(codes).toContain(expected);
  });

  it('crea ingrediente, almacen y registra compra y ajustes', async () => {
    const unit = await pool.query(`SELECT id FROM units WHERE code='KG' LIMIT 1`);
    const unitId = unit.rows[0].id;

    const ingredient = await call(adminCookie, 'POST', '/api/v1/ingredients', { name: 'Masa de prueba', sku: 'PRUEBA-MASA', baseUnitId: unitId });
    expect(ingredient.status).toBe(201);
    ingredientId = ingredient.json.data.id;

    const duplicate = await call(adminCookie, 'POST', '/api/v1/ingredients', { name: 'Masa de prueba', sku: 'PRUEBA-MASA2', baseUnitId: unitId });
    expect(duplicate.status).toBe(409);

    const warehouse = await call(adminCookie, 'POST', '/api/v1/warehouses', { branchId: env.branchId, name: 'Almacen principal' });
    expect(warehouse.status).toBe(201);
    warehouseId = warehouse.json.data.id;

    const emptyBalances = await call(adminCookie, 'GET', `/api/v1/inventory/balances?branchId=${env.branchId}`);
    const emptyRow = emptyBalances.json.data.find((b: { ingredient_id: string }) => b.ingredient_id === ingredientId);
    expect(emptyRow).toBeDefined();
    expect(Number(emptyRow.quantity)).toBe(0);

    const purchase = await call(adminCookie, 'POST', '/api/v1/inventory/adjustments', { branchId: env.branchId, warehouseId, ingredientId, quantity: '10', unitId, type: 'PURCHASE', reason: 'Compra inicial' });
    expect(purchase.status).toBe(201);

    const afterPurchase = await call(adminCookie, 'GET', `/api/v1/inventory/balances?branchId=${env.branchId}`);
    const balance = afterPurchase.json.data.find((b: { ingredient_id: string }) => b.ingredient_id === ingredientId);
    expect(Number(balance.quantity)).toBe(10);

    const consumption = await call(adminCookie, 'POST', '/api/v1/inventory/adjustments', { branchId: env.branchId, warehouseId, ingredientId, quantity: '4', unitId, type: 'NEGATIVE_ADJUSTMENT', reason: 'Consumo registrado' });
    expect(consumption.status).toBe(201);

    const blocked = await call(adminCookie, 'POST', '/api/v1/inventory/adjustments', { branchId: env.branchId, warehouseId, ingredientId, quantity: '999', unitId, type: 'NEGATIVE_ADJUSTMENT', reason: 'Intento de negativo' });
    expect(blocked.status).toBe(409);

    const afterUse = await call(adminCookie, 'GET', `/api/v1/inventory/balances?branchId=${env.branchId}`);
    expect(Number(afterUse.json.data.find((b: { ingredient_id: string }) => b.ingredient_id === ingredientId).quantity)).toBe(6);

    const movements = await call(adminCookie, 'GET', `/api/v1/inventory/movements?branchId=${env.branchId}&ingredientId=${ingredientId}`);
    expect(movements.status).toBe(200);
    expect(movements.json.data.length).toBeGreaterThanOrEqual(2);
  });

  it('registra mermas y ajusta con conteo fisico', async () => {
    const unit = await pool.query(`SELECT id FROM units WHERE code='KG' LIMIT 1`);
    const unitId = unit.rows[0].id;

    const waste = await call(adminCookie, 'POST', '/api/v1/inventory/waste', { branchId: env.branchId, warehouseId, ingredientId, quantity: '2', unitId, reason: 'Merma por quema' });
    expect(waste.status).toBe(201);

    const afterWaste = await call(adminCookie, 'GET', `/api/v1/inventory/balances?branchId=${env.branchId}`);
    expect(Number(afterWaste.json.data.find((b: { ingredient_id: string }) => b.ingredient_id === ingredientId).quantity)).toBe(4);

    const count = await call(adminCookie, 'POST', '/api/v1/inventory/counts', { branchId: env.branchId, warehouseId, notes: 'Conteo mensual' });
    expect(count.status).toBe(201);
    const countId = count.json.data.id;

    const result = await call(adminCookie, 'POST', `/api/v1/inventory/counts/${countId}/result`, { items: [{ ingredientId, countedQuantity: '5', unitId }] });
    expect(result.status).toBe(200);

    const afterCount = await call(adminCookie, 'GET', `/api/v1/inventory/balances?branchId=${env.branchId}`);
    expect(Number(afterCount.json.data.find((b: { ingredient_id: string }) => b.ingredient_id === ingredientId).quantity)).toBe(5);

    const redo = await call(adminCookie, 'POST', `/api/v1/inventory/counts/${countId}/result`, { items: [{ ingredientId, countedQuantity: '7', unitId }] });
    expect(redo.status).toBe(404);
  });

  it('valida ingredientes fuera de la empresa en conteos', async () => {
    const unit = await pool.query(`SELECT id FROM units WHERE code='KG' LIMIT 1`);
    const unitId = unit.rows[0].id;
    const foreignIngredientId = '00000000-0000-0000-0000-0000000000ff';
    const count = await call(adminCookie, 'POST', '/api/v1/inventory/counts', { branchId: env.branchId, warehouseId, notes: 'Conteo con dato ajeno' });
    const countId = count.json.data.id;
    const result = await call(adminCookie, 'POST', `/api/v1/inventory/counts/${countId}/result`, {
      items: [{ ingredientId: foreignIngredientId, countedQuantity: '1', unitId }],
    });
    expect(result.status).toBe(400);
  });

  it('versiona recetas sin sobrescribir versiones anteriores', async () => {
    const unit = await pool.query(`SELECT id FROM units WHERE code='KG' LIMIT 1`);
    const unitId = unit.rows[0].id;

    const recipe = await call(adminCookie, 'POST', '/api/v1/recipes', { name: 'Masa base', notes: 'Version inicial', items: [{ ingredientId, quantity: '0.5', unitId }] });
    expect(recipe.status).toBe(201);
    expect(recipe.json.version.version).toBe(1);
    const recipeId = recipe.json.data.id;

    const v2 = await call(adminCookie, 'POST', `/api/v1/recipes/${recipeId}/versions`, { notes: 'Version corregida', items: [{ ingredientId, quantity: '0.6', unitId }] });
    expect(v2.status).toBe(201);
    expect(v2.json.data.version).toBe(2);

    const listed = await call(adminCookie, 'GET', '/api/v1/recipes');
    const found = listed.json.data.find((r: { id: string }) => r.id === recipeId);
    expect(found.versions).toHaveLength(2);
    expect(found.versions[0].version).toBe(2);

    const detail = await call(adminCookie, 'GET', `/api/v1/recipe-versions/${v2.json.data.id}`);
    expect(detail.status).toBe(200);
    expect(detail.json.data.version).toBe(2);
    expect(detail.json.data.recipe_name).toBe('Masa base');
    const detailItems = detail.json.data.items as { ingredient_id: string; quantity: string }[];
    expect(detailItems).toHaveLength(1);
    expect(Number(detailItems[0].quantity)).toBe(0.6);

    const foreignDetail = await call(adminCookie, 'GET', '/api/v1/recipe-versions/00000000-0000-0000-0000-000000000000');
    expect(foreignDetail.status).toBe(404);
  });
});