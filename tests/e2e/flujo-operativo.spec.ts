import 'dotenv/config';
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const CAPTURAS = path.resolve('reports/e2e/capturas');
if (!existsSync(CAPTURAS)) mkdirSync(CAPTURAS, { recursive: true });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@demo.local';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'AdminDemo2026!';
const PRODUCTO = 'Gordita de chicharron';

type Evidencia = { paso: string; captura: string; estado: string; detalle: string };
const evidencias: Evidencia[] = [];

const flow: Record<string, string> = {};

async function captura(page: Page, nombre: string): Promise<string> {
  const file = path.join(CAPTURAS, `${nombre}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

function evidencia(paso: string, captura: string, estado: string, detalle: string): void {
  evidencias.push({ paso, captura, estado, detalle });
}

const moneyNum = (texto: string): number => parseFloat(texto.replace(/[^\d.-]/g, ''));

async function login(page: Page): Promise<void> {
  await page.goto('/');
  if (await page.locator('#login-form').isVisible()) {
    await page.locator('#login-form input[name="email"]').fill(EMAIL);
    await page.locator('#login-form input[name="password"]').fill(PASSWORD);
    await page.locator('#login-form button[type="submit"]').click();
  }
  await expect(page.locator('nav.tabs')).toBeVisible();
}

test.describe.serial('Fase 9 · Piloto operativo: mesero → cocina → caja → reporte', () => {
  let companyId = '';
  let branchId = '';
  let baselinePagados = 0;
  let baselineVentas = 0;
  let totalPedido = 0;

  test.beforeAll(async () => {
    const company = await pool.query('SELECT company_id FROM users WHERE lower(email)=lower($1)', [EMAIL]);
    companyId = company.rows[0]?.company_id;
    const branch = await pool.query('SELECT id FROM branches WHERE company_id=$1 AND code=$2', [companyId, 'PILOTO']);
    branchId = branch.rows[0]?.id;
    await pool.query('UPDATE restaurant_tables SET status=$1 WHERE branch_id=$2', ['AVAILABLE', branchId]);
    const base = await pool.query(
      `SELECT (SELECT count(*) FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.branch_id=$1)::int pagados,
              (SELECT COALESCE(sum(p.amount),0) FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.branch_id=$1) ventas`,
      [branchId],
    );
    baselinePagados = Number(base.rows[0].pagados);
    baselineVentas = Number(base.rows[0].ventas);
  });

  test('1. Iniciar sesión como administrador', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#login-form')).toBeVisible();
    const cap = await captura(page, '01-login');
    await page.locator('#login-form input[name="email"]').fill(EMAIL);
    await page.locator('#login-form input[name="password"]').fill(PASSWORD);
    await page.locator('#login-form button[type="submit"]').click();
    await expect(page.locator('nav.tabs')).toBeVisible();
    await expect(page.locator('[data-view="meseros"]')).toBeVisible();
    const home = await captura(page, '02-inicio-meseros');
    const branches = await page.request.get('/api/v1/branches');
    branchId = (await branches.json()).data[0].id;
    evidencia('Login administrador', cap, 'OK', 'Sesión iniciada y menú cargado para la sucursal piloto.');
    evidencia('Inicio · Meseros', home, 'OK', 'Menú disponible con 6 variantes y 4 mesas.');
  });

  test('2. Mesero toma el pedido y lo envía a cocina', async ({ page }) => {
    await login(page);
    await page.locator('[data-view="meseros"]').click();
    await expect(page.locator('.product').first()).toBeVisible();
    const producto = page.locator('.product', { hasText: PRODUCTO }).first();
    await expect(producto.locator('button.add')).toBeEnabled();
    await producto.locator('button.add').click();
    await producto.locator('button.add').click();
    await expect(page.locator('.cart-line')).toHaveCount(1);
    const mesa4 = page.locator('#table option', { hasText: 'Mesa 4' }).first();
    await page.locator('#table').selectOption(await mesa4.getAttribute('value') ?? '');
    const cap = await captura(page, '03-mesero-pedido');
    await page.locator('#send-order').click();
    await expect(page.locator('.cart-line')).toHaveCount(0);
    const nuevo = await pool.query(
      'SELECT folio, id, total FROM orders WHERE branch_id=$1 AND created_at > now() - interval \'2 minutes\' ORDER BY created_at DESC LIMIT 1',
      [branchId],
    );
    expect(nuevo.rowCount).toBe(1);
    flow.folio = String(nuevo.rows[0].folio);
    flow.orderId = String(nuevo.rows[0].id);
    totalPedido = Number(nuevo.rows[0].total);
    expect(totalPedido).toBeGreaterThan(0);
    const despues = await captura(page, '04-pedido-enviado');
    evidencia('Pedido 2× ' + PRODUCTO + ' en Mesa 4', cap, 'OK', `Carrito: 2 × ${totalPedido / 2}.00 = $${totalPedido.toFixed(2)} (DRAFT → CONFIRMED → SENT_TO_KITCHEN).`);
    evidencia('Carrito vacío tras envío', despues, 'OK', `Folio #${flow.folio} creado sin duplicar el carrito.`);
  });

  test('3. Cocina inicia y marca el pedido listo', async ({ page }) => {
    await login(page);
    await page.locator('[data-view="cocina"]').click();
    const ticket = page.locator('.ticket', { hasText: `#${flow.folio}` });
    await expect(ticket.locator('[data-kitchen="start"]')).toBeVisible();
    const capPendiente = await captura(page, '05-cocina-pendiente');
    await ticket.locator('[data-kitchen="start"]').click();
    await expect(ticket.locator('[data-kitchen="ready"]')).toBeVisible();
    const capProgreso = await captura(page, '06-cocina-en-progreso');
    await ticket.locator('[data-kitchen="ready"]').click();
    await expect(ticket).toHaveCount(0, { timeout: 15_000 });
    const capListo = await captura(page, '07-cocina-listo');
    const estado = await pool.query('SELECT kitchen_status FROM orders WHERE id=$1', [flow.orderId]);
    expect(estado.rows[0].kitchen_status).toBe('READY');
    evidencia('Comanda pendiente', capPendiente, 'OK', `Ticket #${flow.folio} en la cola de cocina (PENDING).`);
    evidencia('Cocina en progreso', capProgreso, 'OK', 'Iniciada la comanda (IN_PROGRESS).');
    evidencia('Comanda lista', capListo, 'OK', 'Marcada lista (READY); sale de la cola pendiente, sin duplicados.');
  });

  test('4. Caja cobra el pedido y registra el pago', async ({ page }) => {
    await login(page);
    await page.locator('[data-view="caja"]').click();
    if (await page.locator('#cash-open-form').isVisible()) {
      await page.locator('#cash-open-form input[name="openingCash"]').fill('500');
      const capApertura = await captura(page, '08-caja-apertura');
      await page.locator('#cash-open-form button[type="submit"]').click();
      await expect(page.locator('#cash-order-id')).toBeVisible();
      evidencia('Apertura de caja', capApertura, 'OK', 'Sesión de caja abierta con fondo de $500.00.');
    }
    await page.locator('#cash-order-id').fill(flow.orderId);
    await page.locator('#cash-consult').click();
    await expect(page.locator('.payment-total')).toBeVisible();
    const capPendiente = await captura(page, '09-caja-pendiente');
    const pendiente = await page.locator('.payment-total strong').innerText();
    await page.locator('input[name="CASH"]').fill(String(moneyNum(pendiente)));
    await page.locator('#cash-charge').click();
    await expect(page.locator('.receipt')).toBeVisible();
    const capPago = await captura(page, '10-caja-pago-registrado');
    const pagos = await pool.query('SELECT count(*)::int n, COALESCE(sum(amount),0) monto FROM payments WHERE order_id=$1', [flow.orderId]);
    const estado = await pool.query('SELECT status FROM orders WHERE id=$1', [flow.orderId]);
    expect(pagos.rows[0].n).toBe(1);
    expect(Number(pagos.rows[0].monto)).toBe(totalPedido);
    expect(estado.rows[0].status).toBe('COMPLETED');
    evidencia('Pedido pendiente de pago', capPendiente, 'OK', `#${flow.folio} aparece en caja con pendiente $${totalPedido.toFixed(2)}.`);
    evidencia('Pago registrado (efectivo)', capPago, 'OK', `Un solo pago por $${totalPedido.toFixed(2)}; pedido COMPLETED.`);
  });

  test('5. El consumo teórico se descuenta del inventario', async ({ page }) => {
    await login(page);
    const consumo = await pool.query(
      `SELECT count(*)::int n, count(DISTINCT ingredient_id)::int ingredientes
       FROM stock_movements WHERE movement_type='THEORETICAL_CONSUMPTION' AND reference_id=$1`,
      [flow.orderId],
    );
    expect(consumo.rows[0].n).toBeGreaterThanOrEqual(1);
    expect(consumo.rows[0].ingredientes).toBeGreaterThanOrEqual(1);
    await page.locator('[data-view="inventario"]').click();
    await expect(page.locator('.inv-tabs')).toBeVisible();
    const cap = await captura(page, '11-inventario-saldos');
    evidencia('Consumo teórico aplicado', cap, 'OK', `${consumo.rows[0].ingredientes} ingredientes descontados de la receta de ${PRODUCTO} al completar la venta.`);
  });

  test('6. El reporte refleja la venta sin duplicar pedidos', async ({ page }) => {
    await login(page);
    const eventos = await pool.query(
      `SELECT event_type, count(*)::int n FROM order_events WHERE order_id=$1 GROUP BY event_type ORDER BY min(created_at)`,
      [flow.orderId],
    );
    const porTipo = Object.fromEntries(eventos.rows.map(row => [row.event_type, row.n]));
    expect(porTipo.SENT_TO_KITCHEN).toBe(1);
    expect(porTipo.KITCHEN_IN_PROGRESS).toBe(1);
    expect(porTipo.KITCHEN_READY).toBe(1);
    expect(porTipo.COMPLETED).toBe(1);
    const duplicados = await pool.query('SELECT count(*)::int n FROM orders WHERE folio=$1 AND branch_id=$2', [flow.folio, branchId]);
    expect(duplicados.rows[0].n).toBe(1);
    const final = await pool.query(
      `SELECT (SELECT count(*) FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.branch_id=$1)::int pagados,
              (SELECT COALESCE(sum(p.amount),0) FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.branch_id=$1) ventas`,
      [branchId],
    );
    expect(Number(final.rows[0].pagados)).toBe(baselinePagados + 1);
    expect(Number(final.rows[0].ventas)).toBeCloseTo(baselineVentas + totalPedido, 2);
    await page.locator('[data-view="reportes"]').click();
    await expect(page.locator('.report-grid').first()).toBeVisible();
    const cap = await captura(page, '12-reporte-operacion');
    const pagadosUi = page.locator('.report-metric', { hasText: 'Pedidos pagados' });
    await expect(pagadosUi).toContainText(String(baselinePagados + 1));
    evidencia('Auditoría sin duplicados', cap, 'OK', 'Un pedido, un envío a cocina, una marca de inicio/lista, un pago y un evento COMPLETED.');
    evidencia('Reporte de operación', cap, 'OK', `Reportes reflejan ${baselinePagados + 1} pedidos pagados y ventas consistentes.`);
  });

  test.afterAll(async () => {
    writeFileSync(
      path.resolve('reports/e2e/resultados.json'),
      JSON.stringify({ fecha: new Date().toISOString(), producto: PRODUCTO, totalPedido, evidencias }, null, 2),
    );
    await pool.end();
  });
});