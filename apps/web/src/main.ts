import './styles.css';

type Branch = { id: string; name: string; code: string; address?: string };
type Table = { id: string; name: string; capacity: number; status: string };
type Variant = { id: string; name: string; price: number };
type Product = { id: string; name: string; description?: string; category_name: string; is_available: boolean; variants: Variant[] };
type CartLine = { product: Product; variant: Variant; quantity: number };
type User = { id: string; email?: string; name?: string; roles?: string[] };
type KitchenTicket = { id: string; folio?: string | number; kitchen_status?: string; items?: { product_name: string; variant_name?: string; quantity: number }[]; created_at?: string };
type CashSession = { id: string; branch_id: string; status: 'OPEN' | 'CLOSED'; opening_cash: number; opened_at: string; counted_cash?: number; opening_note?: string; closing_note?: string };
type CashMovement = { id: string; order_id: string; folio: string | number; method: 'CASH' | 'CARD' | 'TRANSFER'; amount: number; created_at: string };
type CashOrder = { id: string; folio: string | number; status: string; total: number; paid: number; created_at: string };
type SalesSummary = { salesTotal: number; paidOrders: number; averageTicket: number; salesByPaymentMethod: Record<string, number>; cancellations: number };
type OperationsSummary = { open_orders: number; pending_kitchen: number; delayed_kitchen: number; occupied_tables: number; open_tables: number; unavailable_products: number };
type ReportState = { sales?: SalesSummary; operations?: OperationsSummary; permissionDenied: boolean; pending: boolean; error: string; dateFrom: string; dateTo: string };
type Unit = { id: string; company_id: string | null; code: string; name: string; is_active: boolean };
type Ingredient = { id: string; name: string; sku?: string | null; base_unit_id: string; base_unit_code: string; is_active: boolean };
type Warehouse = { id: string; branch_id: string; name: string; is_active: boolean };
type StockBalance = { warehouse_id: string; warehouse_name: string; ingredient_id: string; ingredient_name: string; quantity: number | string; unit_code: string; updated_at?: string };
type StockMovement = { id: string; ingredient_id: string; ingredient_name: string; warehouse_id: string; warehouse_name: string; movement_type: string; quantity: number | string; unit_code: string; reason: string; reference_id?: string | null; created_at: string };
type RecipeSummary = { id: string; name: string; versions?: { id: string; version: number; notes?: string | null; created_at: string }[] };
type RecipeVersionDetail = { id: string; recipe_id: string; recipe_name: string; version: number; notes?: string | null; created_at: string; items: { ingredient_id: string; ingredient_name: string; quantity: string; unit_code: string }[] };
type RecipeDraftItem = { ingredientId: string; quantity: string; unitId: string };
type InvCount = { id: string; warehouse_id: string };
type InventoryTab = 'saldos' | 'movimientos' | 'conteos' | 'recetas' | 'catalogo';
type InventoryState = {
  tab: InventoryTab; units: Unit[]; ingredients: Ingredient[]; warehouses: Warehouse[];
  balances: StockBalance[]; movements: StockMovement[]; recipes: RecipeSummary[];
  warehouseId: string; movementIngredientId: string; recipeItems: RecipeDraftItem[];
  newVersionFor?: string; count?: InvCount; version?: RecipeVersionDetail;
  pending: boolean; error: string;
};
class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

const api = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string> | undefined) };
  if (options.body !== undefined && options.body !== null) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { credentials: 'include', ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error || `Error ${response.status}`, response.status);
  return body as T;
};

const state: { user?: User; branches: Branch[]; branch?: Branch; tables: Table[]; menu: Product[]; cart: CartLine[]; view: 'meseros' | 'cocina' | 'caja' | 'reportes' | 'inventario'; loading: boolean; error: string; connected: boolean; kitchen: KitchenTicket[]; kitchenPending: boolean; report: ReportState; inventory: InventoryState; cash?: CashSession; movements: CashMovement[]; cashOrders: CashOrder[]; selectedOrder?: CashOrder; lastOrderId?: string; receipt?: { orderId: string; totalPaid: number; pending: number; change: number } } = {
  branches: [], tables: [], menu: [], cart: [], view: 'meseros', loading: false, error: '', connected: true, kitchen: [], kitchenPending: false, report: { permissionDenied: false, pending: false, error: '', dateFrom: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10), dateTo: new Date(Date.now() + 86400000).toISOString().slice(0, 10) }, inventory: { tab: 'saldos', units: [], ingredients: [], warehouses: [], balances: [], movements: [], recipes: [], warehouseId: '', movementIngredientId: '', recipeItems: [], pending: false, error: '' }, movements: [], cashOrders: [],
};
let kitchenStream: EventSource | undefined;
const root = document.querySelector<HTMLDivElement>('#app')!;
const money = (value: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value);
const esc = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] || char);
const total = () => state.cart.reduce((sum, line) => sum + line.variant.price * line.quantity, 0);
const setBusy = (busy: boolean) => { state.loading = busy; render(); };
const showError = (error: unknown) => { state.error = error instanceof Error ? error.message : 'No fue posible completar la operación'; state.connected = true; render(); };

function render(): void {
  if (!state.user) { renderLogin(); return; }
  root.innerHTML = `<div class="app-shell">
    <header class="topbar"><div class="brand"><span class="brand-mark">G</span><div><strong>GorditasOS</strong><small>Operación diaria</small></div></div>
      <div class="top-actions"><span class="connection ${state.connected ? 'online' : 'offline'}"><i></i>${state.connected ? 'Conectado' : 'Sin conexión'}</span><button class="ghost" id="logout">Salir</button></div></header>
    <main><div class="page-heading"><div><p class="eyebrow">${state.view === 'meseros' ? 'Sala y pedidos' : state.view === 'cocina' ? 'Producción' : state.view === 'caja' ? 'Cobros y turno' : state.view === 'inventario' ? 'Inventario y recetas' : 'Consulta operativa'}</p><h1>${state.view === 'meseros' ? 'Toma de pedidos' : state.view === 'cocina' ? 'Cocina' : state.view === 'caja' ? 'Caja' : state.view === 'inventario' ? 'Inventario' : 'Reportes'}</h1></div>
      <select id="branch" aria-label="Sucursal activa">${state.branches.map(branch => `<option value="${branch.id}" ${branch.id === state.branch?.id ? 'selected' : ''}>${esc(branch.name)} · ${esc(branch.code)}</option>`).join('')}</select></div>
      <nav class="tabs"><button class="${state.view === 'meseros' ? 'active' : ''}" data-view="meseros">Meseros</button><button class="${state.view === 'cocina' ? 'active' : ''}" data-view="cocina">Cocina</button><button class="${state.view === 'inventario' ? 'active' : ''}" data-view="inventario">Inventario</button><button class="${state.view === 'caja' ? 'active' : ''}" data-view="caja">Caja</button><button class="${state.view === 'reportes' ? 'active' : ''}" data-view="reportes">Reportes</button></nav>
      ${state.error ? `<div class="alert error">${esc(state.error)}<button id="clear-error" aria-label="Cerrar error">×</button></div>` : ''}
      ${state.view === 'meseros' ? waiterView() : state.view === 'cocina' ? kitchenView() : state.view === 'caja' ? cashView() : state.view === 'inventario' ? inventoryView() : reportsView()}
    </main></div>`;
  bindCommon();
  if (state.view === 'meseros') bindWaiter(); else if (state.view === 'cocina') bindKitchen(); else if (state.view === 'caja') bindCash(); else if (state.view === 'inventario') bindInventory(); else bindReports();
}

function renderLogin(): void { root.innerHTML = `<main class="login-page"><section class="login-art"><span class="brand-mark">G</span><p class="eyebrow">Operación multisucursal</p><h1>El servicio empieza aquí.</h1><p>Pedidos claros, cocina sincronizada y una operación que sigue el ritmo de tu equipo.</p></section><section class="login-panel"><div><p class="eyebrow">Bienvenido</p><h2>Iniciar sesión</h2><p class="muted">Usa tu cuenta autorizada para continuar.</p></div><form id="login-form"><label>Correo electrónico<input name="email" type="email" autocomplete="username" required placeholder="tu@restaurante.mx"></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label><button class="primary wide" type="submit" ${state.loading ? 'disabled' : ''}>${state.loading ? 'Entrando…' : 'Entrar a la operación'}</button></form>${state.error ? `<div class="alert error">${esc(state.error)}</div>` : ''}<p class="login-note">Sesión protegida con cookie segura.</p></section></main>`;
  document.querySelector<HTMLFormElement>('#login-form')!.onsubmit = async event => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); setBusy(true); try { await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) }); await loadSession(); } catch (error) { state.loading = false; showError(error); } };
}

function waiterView(): string { const categories = [...new Set(state.menu.map(product => product.category_name))]; return `<div class="workspace"><section class="menu-panel"><div class="section-head"><div><h2>Menú disponible</h2><p class="muted">Toca un artículo para agregarlo al pedido.</p></div><span class="count">${state.menu.length} artículos</span></div>${state.menu.length ? categories.map(category => `<div class="category"><h3>${esc(category)}</h3><div class="product-grid">${state.menu.filter(product => product.category_name === category).map(product => `<article class="product ${!product.is_available ? 'disabled' : ''}"><div><h4>${esc(product.name)}</h4><p>${esc(product.description || 'Preparado al momento')}</p></div><div class="product-bottom"><span>${product.is_available ? money(product.variants[0]?.price || 0) : 'Agotado'}</span><button class="add" data-product="${product.id}" ${product.is_available ? '' : 'disabled'} aria-label="Agregar ${esc(product.name)}">+</button></div></article>`).join('')}</div></div>`).join('') : '<div class="empty"><strong>Menú no disponible</strong><p>Selecciona una sucursal con catálogo activo.</p></div>'}</section><aside class="order-panel"><div class="section-head"><div><p class="eyebrow">Nueva comanda</p><h2>Pedido actual</h2></div><span class="order-status">Borrador</span></div><label class="compact-label">Mesa<select id="table"><option value="">Para llevar</option>${state.tables.filter(table => table.status !== 'DISABLED').map(table => `<option value="${table.id}">${esc(table.name)} · ${table.capacity} lugares</option>`).join('')}</select></label><div class="cart">${state.cart.length ? state.cart.map((line, index) => `<div class="cart-line"><div><strong>${esc(line.product.name)}</strong><small>${esc(line.variant.name)} · ${money(line.variant.price)}</small></div><div class="quantity"><button data-cart="${index}" data-change="-1">−</button><b>${line.quantity}</b><button data-cart="${index}" data-change="1">+</button></div></div>`).join('') : '<div class="empty cart-empty"><span>＋</span><strong>Tu pedido está vacío</strong><p>Agrega artículos del menú.</p></div>'}</div><div class="order-total"><span>Total estimado</span><strong>${money(total())}</strong></div><button class="primary wide" id="send-order" ${state.cart.length && !state.loading ? '' : 'disabled'}>${state.loading ? 'Enviando…' : 'Confirmar y enviar a cocina'}</button></aside></div>`; }

function kitchenView(): string { return `<section class="kitchen-view"><div class="section-head"><div><h2>Comandas pendientes</h2><p class="muted">Actualización automática cada 15 segundos.</p></div><button class="secondary" id="refresh-kitchen">↻ Actualizar</button></div>${state.kitchenPending ? '<div class="empty"><strong>El módulo de cocina está pendiente</strong><p>La API actual no expone una acción separada de aceptar. Consulta el contrato en el README.</p></div>' : state.kitchen.length ? `<div class="ticket-grid">${state.kitchen.map(ticket => { const status = ticket.kitchen_status || ''; return `<article class="ticket"><div class="ticket-top"><strong>#${esc(ticket.folio || ticket.id.slice(0, 6))}</strong><span>${esc(status)}</span></div><small>${ticket.created_at ? new Date(ticket.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : ''}</small><ul>${(ticket.items || []).map(item => `<li><b>${item.quantity}×</b> ${esc(item.product_name)} ${esc(item.variant_name || '')}</li>`).join('')}</ul><div class="ticket-actions">${status === 'PENDING' ? `<button class="primary" data-kitchen="start" data-id="${ticket.id}">Iniciar</button>` : ''}${status === 'IN_PROGRESS' ? `<button class="primary" data-kitchen="ready" data-id="${ticket.id}">Marcar listo</button>` : ''}</div></article>`; }).join('')}</div>` : '<div class="empty"><strong>Todo al día</strong><p>No hay comandas pendientes en esta sucursal.</p></div>'}</section>`; }

function reportMetric(label: string, value: string): string { return `<article class="report-metric"><span>${label}</span><strong>${value}</strong></article>`; }
function reportsView(): string {
  if (!state.branch) return '<div class="empty"><strong>Sin sucursal activa</strong><p>Selecciona una sucursal para consultar la operación.</p></div>';
  const sales = state.report.sales;
  const operations = state.report.operations;
  const paymentMethods = sales ? Object.entries(sales.salesByPaymentMethod).map(([method, value]) => `<div class="report-row"><strong>${esc(method)}</strong><span>${money(value)}</span></div>`).join('') || '<p class="muted">Sin pagos registrados en el periodo.</p>' : '<p class="muted">Cargando resumen de ventas…</p>';
  const content = state.report.permissionDenied ? '<div class="empty"><strong>Sin permiso para consultar reportes</strong><p>Tu sesión no tiene permiso para consultar esta sucursal o exportar sus datos.</p></div>' : state.report.error ? `<div class="empty"><strong>No fue posible cargar los reportes</strong><p>${esc(state.report.error)}</p></div>` : state.report.pending ? '<div class="empty"><strong>Cargando reportes…</strong><p>Consultando ventas y operación.</p></div>' : `<section class="report-section"><div class="section-head"><div><p class="eyebrow">Ventas</p><h2>Resumen comercial</h2></div><span class="count">${sales?.paidOrders ?? 0} pedidos</span></div><div class="report-grid">${reportMetric('Ventas', money(sales?.salesTotal ?? 0))}${reportMetric('Pedidos pagados', String(sales?.paidOrders ?? 0))}${reportMetric('Ticket promedio', money(sales?.averageTicket ?? 0))}${reportMetric('Cancelaciones', String(sales?.cancellations ?? 0))}</div><div class="report-detail-grid"><article class="report-detail"><h3>Métodos de pago</h3>${paymentMethods}</article><article class="report-detail"><h3>Periodo consultado</h3><p class="muted">${state.report.dateFrom} hasta ${state.report.dateTo} (fecha final exclusiva).</p></article></div></section><section class="report-section"><div class="section-head"><div><p class="eyebrow">Operación</p><h2>Estado actual</h2></div><button class="secondary" id="refresh-report" ${state.report.pending ? 'disabled' : ''}>↻ Actualizar</button></div><div class="report-grid">${reportMetric('Pedidos abiertos', String(operations?.open_orders ?? 0))}${reportMetric('Comandas pendientes', String(operations?.pending_kitchen ?? 0))}${reportMetric('Comandas retrasadas', String(operations?.delayed_kitchen ?? 0))}${reportMetric('Productos no disponibles', String(operations?.unavailable_products ?? 0))}</div><div class="report-detail-grid"><article class="report-detail"><h3>Mesas</h3><p class="muted">${operations?.occupied_tables ?? 0} ocupadas · ${operations?.open_tables ?? 0} con pedidos abiertos.</p></article><article class="report-detail"><h3>Actividad</h3><p class="muted">${operations?.open_orders || operations?.pending_kitchen ? 'La sucursal tiene actividad en el periodo.' : 'No hay pedidos ni comandas activas en el periodo.'}</p></article></div></section>`;
  return `<section class="reports-view"><div class="report-toolbar"><div><h2>Resumen de operación</h2><p class="muted">${esc(state.branch.name)} · Los datos se consultan con tu sesión activa.</p></div><div class="report-actions"><label>Desde<input id="report-from" type="date" value="${state.report.dateFrom}"></label><label>Hasta (exclusivo)<input id="report-to" type="date" value="${state.report.dateTo}"></label><button class="secondary" id="export-report" ${state.report.pending || state.report.permissionDenied ? 'disabled' : ''}>⇩ Exportar CSV</button></div></div>${content}</section>`;
}

function cashView(): string {
  if (!state.cash) return `<section class="cash-open-shell"><article class="cash-open-card"><div class="cash-open-header"><div><p class="eyebrow">Inicio de turno</p><h2>Abrir sesión de caja</h2><p class="cash-open-context">Registra el efectivo contado para comenzar a operar en ${esc(state.branch?.name || 'la sucursal seleccionada')}.</p></div><span class="cash-open-badge">Paso 1</span></div><form id="cash-open-form"><label class="cash-open-amount">Fondo inicial<span class="cash-open-input"><span aria-hidden="true">$</span><input name="openingCash" type="number" min="0" step="0.01" inputmode="decimal" required placeholder="0.00" aria-describedby="cash-open-currency"></span><small id="cash-open-currency">Importe en MXN</small></label><label class="cash-open-note">Nota de apertura <span>Opcional</span><input name="openingNote" maxlength="500" placeholder="Agrega una referencia para este turno"></label><div class="cash-open-guide"><div><span class="cash-open-guide-icon" aria-hidden="true">✓</span><div><strong>Todo listo para iniciar</strong><p>El fondo inicial quedará asociado a la sesión de caja.</p></div></div><span class="cash-open-summary">Monto registrado al abrir</span></div><button class="primary wide cash-open-submit" type="submit" ${state.loading || !state.connected ? 'disabled' : ''}>${state.loading ? 'Abriendo…' : 'Abrir caja'}</button></form></article></section>`;
  const selected = state.selectedOrder;
  const paid = selected ? Number(selected.paid) : 0;
  const entered = ['CASH', 'CARD', 'TRANSFER'].reduce((sum, method) => sum + Number((document.querySelector(`[name="${method}"]`) as HTMLInputElement)?.value || 0), 0);
  const pending = selected ? Math.max(0, Number(selected.total) - paid - entered) : 0;
  return `<div class="cash-layout"><section class="cash-card"><div class="section-head"><div><p class="eyebrow">Sesión abierta</p><h2>Cobrar pedido</h2></div><span class="order-status">${new Date(state.cash.opened_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span></div><div class="cash-search"><input id="cash-order-id" placeholder="ID del pedido recién creado" value="${esc(state.lastOrderId || '')}"><button class="secondary" id="cash-consult">Consultar</button></div>${state.cashOrders.length ? `<div class="cash-orders"><h3>Pendientes de pago</h3>${state.cashOrders.map(order => `<button class="cash-order ${selected?.id === order.id ? 'selected' : ''}" data-cash-order="${order.id}"><strong>#${esc(order.folio)}</strong><span>${money(Number(order.total) - Number(order.paid))}</span></button>`).join('')}</div>` : '<p class="muted">No hay pedidos pendientes de pago.</p>'}${selected ? `<div class="payment-box"><div class="payment-total"><span>Total ${money(Number(selected.total))}</span><strong>Pendiente ${money(pending)}</strong></div><div class="payment-fields"><label>Efectivo<input name="CASH" type="number" min="0" step="0.01" inputmode="decimal" value="0"></label><label>Tarjeta<input name="CARD" type="number" min="0" step="0.01" inputmode="decimal" value="0"></label><label>Transferencia<input name="TRANSFER" type="number" min="0" step="0.01" inputmode="decimal" value="0"></label></div><p class="change">Cambio: <strong>${money(Math.max(0, entered - (Number(selected.total) - paid)))}</strong></p><button class="primary wide" id="cash-charge" ${!state.connected ? 'disabled' : ''}>Cobrar</button></div>` : ''}${state.receipt ? `<div class="receipt success"><strong>Pago registrado</strong><span>Total pagado ${money(state.receipt.totalPaid)}</span><span>Pendiente ${money(state.receipt.pending)} · Cambio ${money(state.receipt.change)}</span></div>` : ''}</section><aside class="cash-card"><p class="eyebrow">Control de caja</p><h2>Movimientos</h2><div class="cash-summary"><span>Fondo inicial<strong>${money(Number(state.cash.opening_cash))}</strong></span><span>Movimientos<strong>${state.movements.length}</strong></span></div><div class="movement-list">${state.movements.length ? state.movements.map(move => `<div class="movement"><span>#${esc(move.folio)} · ${move.method === 'CASH' ? 'Efectivo' : move.method === 'CARD' ? 'Tarjeta' : 'Transferencia'}</span><strong>${money(Number(move.amount))}</strong></div>`).join('') : '<p class="muted">Sin movimientos todavía.</p>'}</div><form id="cash-close-form" class="close-form"><h3>Cerrar sesión</h3><label>Efectivo contado<input name="countedCash" type="number" min="0" step="0.01" inputmode="decimal" required></label><label>Nota de cierre<textarea name="closingNote" maxlength="500" rows="2"></textarea></label><button class="secondary wide" type="submit">Cerrar caja</button></form></aside></div>`;
}

function bindCash(): void {
  document.querySelector('#cash-open-form')?.addEventListener('submit', openCash);
  document.querySelector('#cash-consult')?.addEventListener('click', consultCashOrder);
  document.querySelectorAll<HTMLButtonElement>('[data-cash-order]').forEach(button => button.onclick = () => { state.selectedOrder = state.cashOrders.find(order => order.id === button.dataset.cashOrder); state.receipt = undefined; render(); bindCash(); });
  document.querySelector('#cash-charge')?.addEventListener('click', chargeOrder);
  document.querySelector('#cash-close-form')?.addEventListener('submit', closeCash);
}
function bindReports(): void {
  document.querySelector('#refresh-report')?.addEventListener('click', loadReport);
  document.querySelector('#export-report')?.addEventListener('click', exportReport);
  document.querySelector('#report-from')?.addEventListener('change', loadReport);
  document.querySelector('#report-to')?.addEventListener('change', loadReport);
}
function reportQuery(): string {
  const from = (document.querySelector('#report-from') as HTMLInputElement)?.value || state.report.dateFrom;
  const to = (document.querySelector('#report-to') as HTMLInputElement)?.value || state.report.dateTo;
  state.report.dateFrom = from;
  state.report.dateTo = to;
  const params = new URLSearchParams({ dateFrom: from, dateTo: to });
  if (state.branch) params.set('branchId', state.branch.id);
  return params.toString();
}
async function loadReport(): Promise<void> {
  if (!state.branch) return;
  const query = reportQuery();
  if (state.report.dateFrom >= state.report.dateTo) { state.report = { ...state.report, error: 'La fecha final debe ser posterior a la fecha inicial.', pending: false }; render(); return; }
  state.report = { ...state.report, pending: true, permissionDenied: false, error: '' };
  render();
  try {
    const [sales, operations] = await Promise.all([
      api<{ data: SalesSummary }>(`/api/v1/reports/sales-summary?${query}`),
      api<{ data: OperationsSummary }>(`/api/v1/reports/operations-summary?${query}`),
    ]);
    state.report = { ...state.report, sales: sales.data, operations: operations.data, permissionDenied: false, pending: false, error: '' };
    state.connected = true;
    render();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    const permissionDenied = error instanceof ApiError ? error.status === 403 : /403|permiso|autorizada/i.test(message);
    state.report = { ...state.report, sales: undefined, operations: undefined, permissionDenied, pending: false, error: permissionDenied ? '' : message };
    state.connected = !state.report.permissionDenied;
    render();
  }
}
async function exportReport(): Promise<void> {
  if (!state.branch) return;
  const query = reportQuery();
  if (state.report.dateFrom >= state.report.dateTo) { state.report = { ...state.report, error: 'La fecha final debe ser posterior a la fecha inicial.' }; render(); return; }
  const button = document.querySelector<HTMLButtonElement>('#export-report');
  if (button) button.disabled = true;
  try {
    const response = await fetch(`/api/v1/reports/sales-summary.csv?${query}`, { credentials: 'include' });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new ApiError(body.error || `Error ${response.status}`, response.status); }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `sales-summary-${state.report.dateFrom}-${state.report.dateTo}.csv`;
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No fue posible exportar el reporte';
    state.report = { ...state.report, permissionDenied: error instanceof ApiError && error.status === 403, error: error instanceof ApiError && error.status === 403 ? '' : message };
    render();
  }
}
const INVENTORY_TABS: { id: InventoryTab; label: string }[] = [
  { id: 'saldos', label: 'Saldos' },
  { id: 'movimientos', label: 'Movimientos' },
  { id: 'conteos', label: 'Conteos' },
  { id: 'recetas', label: 'Recetas' },
  { id: 'catalogo', label: 'Catálogo' },
];
const invOptUnits = (selectedId?: string): string => state.inventory.units.length
  ? state.inventory.units.map(unit => `<option value="${unit.id}" ${unit.id === selectedId ? 'selected' : ''}>${esc(unit.name)} (${esc(unit.code)})</option>`).join('')
  : '<option value="">Sin unidades</option>';
const invOptIngredients = (selectedId?: string): string => `<option value="">Selecciona un ingrediente…</option>${state.inventory.ingredients.map(ingredient => `<option value="${ingredient.id}" ${ingredient.id === selectedId ? 'selected' : ''}>${esc(ingredient.name)}</option>`).join('')}`;
const invOptWarehouses = (selectedId?: string): string => state.inventory.warehouses.length
  ? `<option value="">Selecciona un almacén…</option>${state.inventory.warehouses.map(warehouse => `<option value="${warehouse.id}" ${warehouse.id === selectedId ? 'selected' : ''}>${esc(warehouse.name)}</option>`).join('')}`
  : '<option value="">Sin almacenes en esta sucursal</option>';
const invDate = (value: string): string => new Date(value).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });

function inventoryView(): string {
  const subnav = `<div class="tabs inv-tabs">${INVENTORY_TABS.map(tab => `<button class="${state.inventory.tab === tab.id ? 'active' : ''}" data-inv-tab="${tab.id}">${tab.label}</button>`).join('')}</div>`;
  const content = state.inventory.pending ? '<div class="empty"><strong>Cargando inventario…</strong><p>Consultando unidades, existencias y recetas.</p></div>'
    : state.inventory.error ? `<div class="empty"><strong>No fue posible cargar el inventario</strong><p>${esc(state.inventory.error)}</p></div>`
    : state.inventory.tab === 'saldos' ? inventoryBalancesView()
    : state.inventory.tab === 'movimientos' ? inventoryMovementsView()
    : state.inventory.tab === 'conteos' ? inventoryCountsView()
    : state.inventory.tab === 'recetas' ? inventoryRecipesView()
    : inventoryCatalogView();
  return `<section class="inventory-view">${subnav}${content}</section>`;
}

function inventoryBalancesView(): string {
  const balances = state.inventory.balances;
  return `<div class="report-section"><div class="section-head"><div><p class="eyebrow">Existencias</p><h2>Saldos por almacén</h2></div><label class="compact-label" style="margin:0">Almacén<select data-balances-warehouse>${state.inventory.warehouses.length ? state.inventory.warehouses.map(warehouse => `<option value="${warehouse.id}" ${warehouse.id === state.inventory.warehouseId ? 'selected' : ''}>${esc(warehouse.name)}</option>`).join('') : '<option value="">Sin almacenes</option>'}</select></label></div>
    ${balances.length ? `<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Ingrediente</th><th>Almacén</th><th>Existencia</th><th>Última actualización</th></tr></thead><tbody>${balances.map(balance => `<tr><td><strong>${esc(balance.ingredient_name)}</strong></td><td>${esc(balance.warehouse_name)}</td><td>${String(balance.quantity)} ${esc(balance.unit_code)}</td><td>${balance.updated_at ? invDate(balance.updated_at) : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><strong>Sin existencias que mostrar</strong><p>Registra almacenes e ingredientes para consultar saldos.</p></div>'}</div>`;
}

function inventoryMovementsView(): string {
  const movements = state.inventory.movements;
  return `<div class="inv-grid">
    <section class="report-section inv-card"><div class="section-head"><div><p class="eyebrow">Registro</p><h2>Ajuste o compra</h2></div></div>
      <form id="inv-adjust-form" class="inv-form">
        <label><span>Tipo de movimiento</span><select name="type"><option value="PURCHASE">Compra</option><option value="POSITIVE_ADJUSTMENT">Ajuste positivo</option><option value="NEGATIVE_ADJUSTMENT">Ajuste negativo</option></select></label>
        <label><span>Almacén</span><select name="warehouseId" required>${invOptWarehouses()}</select></label>
        <label><span>Ingrediente</span><select name="ingredientId" required>${invOptIngredients()}</select></label>
        <label><span>Unidad</span><select name="unitId" required>${invOptUnits()}</select></label>
        <label><span>Cantidad</span><input name="quantity" type="number" inputmode="decimal" step="0.00000001" min="0.00000001" required placeholder="0"></label>
        <label class="inv-full"><span>Motivo</span><input name="reason" maxlength="500" required placeholder="Por ejemplo: compra a proveedor, inventario inicial, ajuste por error"></label>
        <button class="primary" type="submit">Registrar movimiento</button>
      </form></section>
    <section class="report-section inv-card"><div class="section-head"><div><p class="eyebrow">Desperdicio</p><h2>Registrar merma</h2></div></div>
      <form id="inv-waste-form" class="inv-form">
        <label><span>Almacén</span><select name="warehouseId" required>${invOptWarehouses()}</select></label>
        <label><span>Ingrediente</span><select name="ingredientId" required>${invOptIngredients()}</select></label>
        <label><span>Unidad</span><select name="unitId" required>${invOptUnits()}</select></label>
        <label><span>Cantidad</span><input name="quantity" type="number" inputmode="decimal" step="0.00000001" min="0.00000001" required placeholder="0"></label>
        <label class="inv-full"><span>Motivo</span><input name="reason" maxlength="500" required placeholder="Por ejemplo: producto vencido, derrame, dañado"></label>
        <button class="primary" type="submit">Registrar merma</button>
      </form></section></div>
  <section class="report-section"><div class="section-head"><div><p class="eyebrow">Histórico</p><h2>Movimientos</h2></div><div><label class="compact-label" style="margin:0">Filtrar ingrediente<select id="inv-movement-filter">${invOptIngredients(state.inventory.movementIngredientId || undefined)}</select></label></div></div>
    ${movements.length ? `<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Fecha</th><th>Ingrediente</th><th>Tipo</th><th>Cantidad</th><th>Almacén</th><th>Motivo</th></tr></thead><tbody>${movements.map(movement => `<tr><td>${invDate(movement.created_at)}</td><td>${esc(movement.ingredient_name)}</td><td>${esc(movement.movement_type)}</td><td>${String(movement.quantity)} ${esc(movement.unit_code)}</td><td>${esc(movement.warehouse_name)}</td><td>${esc(movement.reason)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><strong>Sin movimientos</strong><p>Los movimientos aparecerán aquí al registrar compras, ajustes o mermas.</p></div>'}</section>`;
}

function inventoryCountsView(): string {
  const count = state.inventory.count;
  if (!count) return `<section class="report-section inv-card"><div class="section-head"><div><p class="eyebrow">Conteo físico</p><h2>Iniciar un conteo</h2></div></div>
    <form id="inv-count-form" class="inv-form">
      <label class="inv-full"><span>Almacén a contar</span><select name="warehouseId" required>${state.inventory.warehouses.length ? state.inventory.warehouses.map(warehouse => `<option value="${warehouse.id}">${esc(warehouse.name)}</option>`).join('') : '<option value="">Sin almacenes</option>'}</select></label>
      <label class="inv-full"><span>Notas</span><input name="notes" maxlength="500" placeholder="Opcional: turno, auditoría…"></label>
      <button class="primary" type="submit">Iniciar conteo</button>
    </form></section>`;
  const balances = state.inventory.balances.filter(balance => balance.warehouse_id === count.warehouse_id);
  return `<section class="report-section"><div class="section-head"><div><p class="eyebrow">Conteo abierto</p><h2>Captura el resultado</h2></div><button class="secondary" id="inv-count-cancel">Cancelar</button></div>
    <p class="muted">Ingresa la cantidad contada físicamente por ingrediente. La diferencia ajustará el saldo automáticamente.</p>
    ${balances.length ? `<form id="inv-count-result-form" class="inv-form">${balances.map(balance => `<label><span>${esc(balance.ingredient_name)} · teórico ${String(balance.quantity)} ${esc(balance.unit_code)}</span><input name="count-${balance.ingredient_id}" type="number" inputmode="decimal" step="0.00000001" min="0" required value="${String(balance.quantity)}"></label>`).join('')}<button class="primary" type="submit">Completar conteo</button></form>` : '<div class="empty"><strong>Sin ingredientes en este almacén</strong><p>Registra movimientos para generar saldos antes de contar.</p></div>'}</section>`;
}

function inventoryRecipesView(): string {
  const recipes = state.inventory.recipes;
  const version = state.inventory.version;
  const versionFor = state.inventory.newVersionFor ? recipes.find(recipe => recipe.id === state.inventory.newVersionFor) : undefined;
  const itemsList = state.inventory.recipeItems.length ? `<div class="inv-full inv-list">${state.inventory.recipeItems.map((item, index) => { const ingredient = state.inventory.ingredients.find(candidate => candidate.id === item.ingredientId); const unit = state.inventory.units.find(candidate => candidate.id === item.unitId); return `<article class="inv-item"><span>${esc(ingredient?.name || '')} · ${item.quantity} ${esc(unit?.code || '')}</span><button class="ghost" data-recipe-remove="${index}">Quitar</button></article>`; }).join('')}</div>` : '';
  const form = versionFor
    ? `<section class="report-section inv-card"><div class="section-head"><div><p class="eyebrow">Receta existente</p><h2>Nueva versión de ${esc(versionFor.name)}</h2></div><button class="secondary" id="inv-version-cancel">Cancelar</button></div>
      <form id="inv-recipe-form" data-recipe-mode="version" class="inv-form">
        <label><span>Ingrediente</span><select data-recipe-ingredient>${invOptIngredients()}</select></label>
        <label><span>Cantidad</span><input data-recipe-quantity type="number" inputmode="decimal" step="0.00000001" min="0.00000001" value="1"></label>
        <label><span>Unidad</span><select data-recipe-unit>${invOptUnits()}</select></label>
        <div class="inv-full inv-actions"><button class="secondary" type="button" id="inv-recipe-add">+ Agregar ingrediente</button></div>
        ${itemsList}
        <label class="inv-full"><span>Notas de la versión</span><input name="notes" maxlength="500" placeholder="Opcional: qué cambió"></label>
        <button class="primary" type="submit">Guardar versión</button>
      </form></section>`
    : `<section class="report-section inv-card"><div class="section-head"><div><p class="eyebrow">Recetas</p><h2>Nueva receta</h2></div></div>
      <form id="inv-recipe-form" data-recipe-mode="create" class="inv-form">
        <label class="inv-full"><span>Nombre de la receta</span><input name="name" maxlength="160" required placeholder="Ej. Gordita de chicharrón"></label>
        <label><span>Ingrediente</span><select data-recipe-ingredient>${invOptIngredients()}</select></label>
        <label><span>Cantidad</span><input data-recipe-quantity type="number" inputmode="decimal" step="0.00000001" min="0.00000001" value="1"></label>
        <label><span>Unidad</span><select data-recipe-unit>${invOptUnits()}</select></label>
        <div class="inv-full inv-actions"><button class="secondary" type="button" id="inv-recipe-add">+ Agregar ingrediente</button></div>
        ${itemsList}
        <label class="inv-full"><span>Notas</span><input name="notes" maxlength="500" placeholder="Opcional"></label>
        <button class="primary" type="submit">Crear receta</button>
      </form></section>`;
  return `${form}
  <section class="report-section"><div class="section-head"><div><p class="eyebrow">Catálogo</p><h2>Recetas existentes</h2></div></div>
    ${recipes.length ? `<div class="inv-list">${recipes.map(recipe => `<article class="inv-item"><div><strong>${esc(recipe.name)}</strong>${recipe.versions?.length ? `<small>${recipe.versions.length} versión(es)</small>` : '<small>Sin versiones</small>'}</div><div class="inv-item-actions">${(recipe.versions || []).map(item => `<button class="secondary" data-recipe-version="${item.id}">v${item.version} ver</button>`).join('')}<button class="ghost" data-recipe-version-new="${recipe.id}">+ versión</button></div></article>`).join('')}</div>` : '<div class="empty"><strong>Sin recetas</strong><p>Crea la primera receta para habilitar versiones.</p></div>'}</section>
  ${version ? `<section class="report-section"><div class="section-head"><div><p class="eyebrow">Versión ${version.version}</p><h2>${esc(version.recipe_name)}</h2></div><button class="secondary" id="inv-version-close">Cerrar</button></div>
    ${version.notes ? `<p class="muted">${esc(version.notes)}</p>` : ''}
    <div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Ingrediente</th><th>Cantidad</th><th>Unidad</th></tr></thead><tbody>${version.items.map(item => `<tr><td>${esc(item.ingredient_name)}</td><td>${item.quantity}</td><td>${esc(item.unit_code)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
}

function inventoryCatalogView(): string {
  return `<div class="inv-grid">
  <section class="report-section inv-card"><div class="section-head"><div><p class="eyebrow">Almacenes</p><h2>Nuevo almacén</h2></div></div>
    <form id="inv-warehouse-form" class="inv-form"><label class="inv-full"><span>Nombre del almacén</span><input name="name" maxlength="120" required placeholder="Ej. Almacén principal, Cámara fría"></label><button class="primary" type="submit">Crear almacén</button></form>
    ${state.inventory.warehouses.length ? `<div class="inv-list"><h3>Almacenes de ${esc(state.branch?.name || 'esta sucursal')}</h3>${state.inventory.warehouses.map(warehouse => `<article class="inv-item"><strong>${esc(warehouse.name)}</strong><span class="order-status">${warehouse.is_active ? 'Activo' : 'Inactivo'}</span></article>`).join('')}</div>` : ''}</section>
  <section class="report-section inv-card"><div class="section-head"><div><p class="eyebrow">Ingredientes</p><h2>Nuevo ingrediente</h2></div></div>
    <form id="inv-ingredient-form" class="inv-form">
      <label><span>Nombre</span><input name="name" maxlength="160" required placeholder="Ej. Masa de maíz"></label>
      <label><span>SKU</span><input name="sku" maxlength="80" placeholder="Opcional"></label>
      <label class="inv-full"><span>Unidad base</span><select name="baseUnitId" required>${invOptUnits()}</select></label>
      <button class="primary" type="submit">Crear ingrediente</button>
    </form>
    ${state.inventory.ingredients.length ? `<div class="inv-list"><h3>Ingredientes del negocio</h3>${state.inventory.ingredients.map(ingredient => `<article class="inv-item"><div><strong>${esc(ingredient.name)}</strong>${ingredient.sku ? `<small>SKU ${esc(ingredient.sku)}</small>` : ''}</div><span class="order-status">${esc(ingredient.base_unit_code)}</span></article>`).join('')}</div>` : ''}</section></div>`;
}

function bindInventory(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-inv-tab]').forEach(button => button.onclick = () => { state.inventory.tab = button.dataset.invTab as InventoryTab; state.inventory.error = ''; render(); bindInventory(); loadInventoryTab(); });
  document.querySelector<HTMLSelectElement>('[data-balances-warehouse]')?.addEventListener('change', event => { state.inventory.warehouseId = (event.target as HTMLSelectElement).value; loadInventoryTab(); });
  document.querySelector('#inv-movement-filter')?.addEventListener('change', event => { state.inventory.movementIngredientId = (event.target as HTMLSelectElement).value; loadInventoryTab(); });
  document.querySelector('#inv-adjust-form')?.addEventListener('submit', submitMovement);
  document.querySelector('#inv-waste-form')?.addEventListener('submit', submitWaste);
  document.querySelector('#inv-count-form')?.addEventListener('submit', startCount);
  document.querySelector('#inv-count-result-form')?.addEventListener('submit', completeCountWeb);
  document.querySelector('#inv-count-cancel')?.addEventListener('click', () => { state.inventory.count = undefined; render(); bindInventory(); });
  document.querySelector('#inv-ingredient-form')?.addEventListener('submit', createIngredient);
  document.querySelector('#inv-warehouse-form')?.addEventListener('submit', createWarehouse);
  document.querySelector('#inv-recipe-form')?.addEventListener('submit', createRecipeWeb);
  document.querySelector('#inv-recipe-add')?.addEventListener('click', addRecipeItem);
  document.querySelector('#inv-version-cancel')?.addEventListener('click', () => { state.inventory.newVersionFor = undefined; render(); bindInventory(); });
  document.querySelectorAll<HTMLButtonElement>('[data-recipe-remove]').forEach(button => button.onclick = () => { state.inventory.recipeItems.splice(Number(button.dataset.recipeRemove), 1); render(); bindInventory(); });
  document.querySelectorAll<HTMLButtonElement>('[data-recipe-version]').forEach(button => button.onclick = () => loadVersion(button.dataset.recipeVersion!));
  document.querySelectorAll<HTMLButtonElement>('[data-recipe-version-new]').forEach(button => button.onclick = () => { state.inventory.newVersionFor = button.dataset.recipeVersionNew; state.inventory.recipeItems = []; state.inventory.version = undefined; render(); bindInventory(); });
  document.querySelector('#inv-version-close')?.addEventListener('click', () => { state.inventory.version = undefined; render(); bindInventory(); });
}

async function loadInventory(): Promise<void> {
  if (!state.branch) return;
  state.inventory = { ...state.inventory, pending: true, error: '' };
  render(); bindInventory();
  try {
    const [units, ingredients, warehouses, recipes] = await Promise.all([
      api<{ data: Unit[] }>('/api/v1/units'),
      api<{ data: Ingredient[] }>('/api/v1/ingredients'),
      api<{ data: Warehouse[] }>(`/api/v1/warehouses?branchId=${state.branch.id}`),
      api<{ data: RecipeSummary[] }>('/api/v1/recipes'),
    ]);
    state.inventory.units = units.data;
    state.inventory.ingredients = ingredients.data;
    state.inventory.warehouses = warehouses.data;
    state.inventory.recipes = recipes.data;
    const selectedWarehouse = state.inventory.warehouseId && warehouses.data.some(warehouse => warehouse.id === state.inventory.warehouseId) ? state.inventory.warehouseId : warehouses.data[0]?.id || '';
    state.inventory.warehouseId = selectedWarehouse;
    state.inventory.pending = false;
    await loadInventoryTab();
  } catch (error) {
    state.inventory.pending = false;
    state.inventory.error = error instanceof Error ? error.message : 'Error desconocido';
    state.connected = true;
    render(); bindInventory();
  }
}

async function loadInventoryTab(): Promise<void> {
  if (!state.branch) return;
  try {
    if (state.inventory.tab === 'saldos' || (state.inventory.tab === 'conteos' && state.inventory.count)) {
      const result = await api<{ data: StockBalance[] }>(`/api/v1/inventory/balances?branchId=${state.branch.id}`);
      state.inventory.balances = state.inventory.warehouseId ? result.data.filter(balance => balance.warehouse_id === state.inventory.warehouseId) : result.data;
    }
    if (state.inventory.tab === 'movimientos') {
      const ingredientId = state.inventory.movementIngredientId || undefined;
      const result = await api<{ data: StockMovement[] }>(`/api/v1/inventory/movements?branchId=${state.branch.id}${ingredientId ? `&ingredientId=${ingredientId}` : ''}`);
      state.inventory.movements = result.data;
    }
    state.inventory.error = '';
    render(); bindInventory();
  } catch (error) {
    state.inventory.error = error instanceof Error ? error.message : 'Error desconocido';
    state.connected = true;
    render(); bindInventory();
  }
}

async function submitMovement(event: Event): Promise<void> {
  event.preventDefault();
  if (!state.branch) return;
  const form = new FormData(event.currentTarget as HTMLFormElement);
  setBusy(true);
  try {
    await api('/api/v1/inventory/adjustments', { method: 'POST', body: JSON.stringify({ branchId: state.branch.id, warehouseId: form.get('warehouseId'), ingredientId: form.get('ingredientId'), quantity: form.get('quantity'), unitId: form.get('unitId'), type: form.get('type'), reason: form.get('reason') }) });
    state.loading = false;
    await loadInventoryTab();
  } catch (error) { showError(error); }
}

async function submitWaste(event: Event): Promise<void> {
  event.preventDefault();
  if (!state.branch) return;
  const form = new FormData(event.currentTarget as HTMLFormElement);
  setBusy(true);
  try {
    await api('/api/v1/inventory/waste', { method: 'POST', body: JSON.stringify({ branchId: state.branch.id, warehouseId: form.get('warehouseId'), ingredientId: form.get('ingredientId'), quantity: form.get('quantity'), unitId: form.get('unitId'), reason: form.get('reason') }) });
    state.loading = false;
    await loadInventoryTab();
  } catch (error) { showError(error); }
}

async function startCount(event: Event): Promise<void> {
  event.preventDefault();
  if (!state.branch) return;
  const form = new FormData(event.currentTarget as HTMLFormElement);
  setBusy(true);
  try {
    const result = await api<{ data: { id: string; warehouse_id: string } }>('/api/v1/inventory/counts', { method: 'POST', body: JSON.stringify({ branchId: state.branch.id, warehouseId: form.get('warehouseId'), notes: form.get('notes') || undefined }) });
    state.inventory.count = { id: result.data.id, warehouse_id: result.data.warehouse_id };
    state.inventory.warehouseId = result.data.warehouse_id;
    state.loading = false;
    await loadInventoryTab();
  } catch (error) { showError(error); }
}

async function completeCountWeb(event: Event): Promise<void> {
  event.preventDefault();
  const count = state.inventory.count;
  if (!count) return;
  const form = new FormData(event.currentTarget as HTMLFormElement);
  const items: { ingredientId: string; countedQuantity: string; unitId: string }[] = [];
  for (const ingredient of state.inventory.ingredients) {
    const value = form.get(`count-${ingredient.id}`);
    if (value !== null && value !== '') items.push({ ingredientId: ingredient.id, countedQuantity: String(value), unitId: ingredient.base_unit_id });
  }
  setBusy(true);
  try {
    await api(`/api/v1/inventory/counts/${count.id}/result`, { method: 'POST', body: JSON.stringify({ items }) });
    state.inventory.count = undefined;
    state.loading = false;
    await loadInventoryTab();
  } catch (error) { showError(error); }
}

async function createIngredient(event: Event): Promise<void> {
  event.preventDefault();
  const form = new FormData(event.currentTarget as HTMLFormElement);
  setBusy(true);
  try {
    await api('/api/v1/ingredients', { method: 'POST', body: JSON.stringify({ name: form.get('name'), sku: form.get('sku') || undefined, baseUnitId: form.get('baseUnitId') }) });
    state.loading = false;
    await loadInventory();
  } catch (error) { showError(error); }
}

async function createWarehouse(event: Event): Promise<void> {
  event.preventDefault();
  if (!state.branch) return;
  const form = new FormData(event.currentTarget as HTMLFormElement);
  setBusy(true);
  try {
    await api('/api/v1/warehouses', { method: 'POST', body: JSON.stringify({ branchId: state.branch.id, name: form.get('name') }) });
    state.loading = false;
    await loadInventory();
  } catch (error) { showError(error); }
}

function addRecipeItem(): void {
  const ingredientId = (document.querySelector('[data-recipe-ingredient]') as HTMLSelectElement)?.value || '';
  const quantity = (document.querySelector('[data-recipe-quantity]') as HTMLInputElement)?.value || '1';
  const unitId = (document.querySelector('[data-recipe-unit]') as HTMLSelectElement)?.value || '';
  if (!ingredientId || !unitId) { state.error = 'Selecciona un ingrediente y su unidad'; render(); bindInventory(); return; }
  state.inventory.recipeItems.push({ ingredientId, quantity, unitId });
  render(); bindInventory();
}

async function createRecipeWeb(event: Event): Promise<void> {
  event.preventDefault();
  if (!state.branch) return;
  const mode = (event.currentTarget as HTMLFormElement).dataset.recipeMode as 'create' | 'version' | undefined;
  const form = new FormData(event.currentTarget as HTMLFormElement);
  const items = state.inventory.recipeItems;
  if (!items.length) { state.error = 'Agrega al menos un ingrediente a la receta'; render(); bindInventory(); return; }
  const payload: Record<string, unknown> = { notes: form.get('notes') || undefined, items: items.map(item => ({ ingredientId: item.ingredientId, quantity: item.quantity, unitId: item.unitId })) };
  if (mode === 'create') payload.name = form.get('name');
  setBusy(true);
  try {
    if (mode === 'version' && state.inventory.newVersionFor) await api(`/api/v1/recipes/${state.inventory.newVersionFor}/versions`, { method: 'POST', body: JSON.stringify(payload) });
    else await api('/api/v1/recipes', { method: 'POST', body: JSON.stringify(payload) });
    state.inventory.recipeItems = [];
    state.inventory.newVersionFor = undefined;
    state.loading = false;
    await loadInventory();
  } catch (error) { showError(error); }
}

async function loadVersion(versionId: string): Promise<void> {
  setBusy(true);
  try {
    const result = await api<{ data: RecipeVersionDetail }>(`/api/v1/recipe-versions/${versionId}`);
    state.inventory.version = result.data;
    state.loading = false;
    render(); bindInventory();
  } catch (error) { showError(error); }
}

async function loadCash(): Promise<void> { if (!state.branch) return; try { const result = await api<{ data: CashSession | null }>(`/api/v1/branches/${state.branch.id}/cash-sessions/current`); state.cash = result.data || undefined; state.movements = []; state.cashOrders = []; state.connected = true; state.loading = false; render(); } catch (error) { state.loading = false; showError(error); } }
async function openCash(event: Event): Promise<void> { event.preventDefault(); if (!state.branch) return; const form = new FormData(event.currentTarget as HTMLFormElement); setBusy(true); try { await api(`/api/v1/branches/${state.branch.id}/cash-sessions/open`, { method: 'POST', body: JSON.stringify({ openingCash: Number(form.get('openingCash')) }) }); await loadCash(); } catch (error) { showError(error); } }
async function consultCashOrder(): Promise<void> { const id = (document.querySelector('#cash-order-id') as HTMLInputElement).value.trim(); if (!id) return; setBusy(true); try { const [orderResult, paymentsResult] = await Promise.all([api<{ data: CashOrder }>(`/api/v1/orders/${encodeURIComponent(id)}`), api<{ data: { method: CashMovement['method']; amount: number; created_at: string; id: string }[] }>(`/api/v1/orders/${encodeURIComponent(id)}/payments`)]); const paid = paymentsResult.data.reduce((sum, payment) => sum + Number(payment.amount), 0); state.selectedOrder = { ...orderResult.data, paid }; state.movements = paymentsResult.data.map(payment => ({ ...payment, order_id: id, folio: orderResult.data.folio })); state.lastOrderId = id; state.error = ''; state.loading = false; render(); bindCash(); } catch (error) { showError(error); } }
async function chargeOrder(): Promise<void> { if (!state.cash || !state.selectedOrder) return; const payments = (['CASH', 'CARD', 'TRANSFER'] as const).map(method => ({ method, amount: Number((document.querySelector(`[name="${method}"]`) as HTMLInputElement).value || 0) })).filter(payment => payment.amount > 0); const requested = payments.reduce((sum, payment) => sum + payment.amount, 0); const pending = Number(state.selectedOrder.total) - Number(state.selectedOrder.paid); if (!payments.length || requested > pending) { state.error = requested > pending ? 'El pago excede el pendiente' : 'Captura al menos un importe'; render(); return; } setBusy(true); try { let totalPaid = Number(state.selectedOrder.paid); let change = 0; for (const payment of payments) { const result = await api<{ data: { amount: number; change_amount: number } }>(`/api/v1/orders/${state.selectedOrder.id}/payments`, { method: 'POST', body: JSON.stringify({ method: payment.method, amount: payment.amount, ...(payment.method === 'CASH' ? { cashReceived: payment.amount } : {}), idempotencyKey: `web-cash-${state.selectedOrder.id}-${payment.method}-${crypto.randomUUID()}` }) }); totalPaid += Number(result.data.amount); change += Number(result.data.change_amount || 0); } state.receipt = { orderId: state.selectedOrder.id, totalPaid, pending: Number(state.selectedOrder.total) - totalPaid, change }; state.selectedOrder = undefined; await loadCash(); } catch (error) { showError(error); } }
async function closeCash(event: Event): Promise<void> { event.preventDefault(); if (!state.cash) return; const form = new FormData(event.currentTarget as HTMLFormElement); setBusy(true); try { await api(`/api/v1/cash-sessions/${state.cash.id}/close`, { method: 'POST', body: JSON.stringify({ countedCash: Number(form.get('countedCash')), closingNote: form.get('closingNote') || undefined }) }); state.cash = undefined; state.movements = []; state.cashOrders = []; state.selectedOrder = undefined; state.loading = false; render(); } catch (error) { showError(error); } }

function bindCommon(): void { document.querySelector('#logout')!.addEventListener('click', async () => { await api('/api/v1/auth/logout', { method: 'POST' }).catch(() => undefined); state.user = undefined; render(); }); document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.onclick = () => { state.view = button.dataset.view as 'meseros' | 'cocina' | 'caja' | 'reportes' | 'inventario'; render(); if (state.view === 'caja') loadCash(); else if (state.view === 'inventario') loadInventory(); else loadBranchData(); }); document.querySelector<HTMLSelectElement>('#branch')!.onchange = event => { state.branch = state.branches.find(branch => branch.id === (event.target as HTMLSelectElement).value); if (state.view === 'caja') { loadCash(); loadBranchData(); } else if (state.view === 'inventario') { state.inventory.warehouseId = ''; state.inventory.count = undefined; state.inventory.movements = []; loadInventory(); } else loadBranchData(); }; document.querySelector('#clear-error')?.addEventListener('click', () => { state.error = ''; render(); }); }
function bindWaiter(): void { document.querySelectorAll<HTMLButtonElement>('[data-product]').forEach(button => button.onclick = () => { const product = state.menu.find(item => item.id === button.dataset.product)!; const variant = product.variants[0]; const line = state.cart.find(item => item.product.id === product.id && item.variant.id === variant.id); if (line) line.quantity++; else state.cart.push({ product, variant, quantity: 1 }); render(); }); document.querySelectorAll<HTMLButtonElement>('[data-cart]').forEach(button => button.onclick = () => { const index = Number(button.dataset.cart); state.cart[index].quantity += Number(button.dataset.change); if (state.cart[index].quantity < 1) state.cart.splice(index, 1); render(); }); document.querySelector('#send-order')?.addEventListener('click', sendOrder); }
async function sendOrder(): Promise<void> {
  if (!state.branch || !state.cart.length) return;
  const cartSnapshot = state.cart.map((line) => ({ ...line }));
  const key = `web-${crypto.randomUUID()}`;
  let stage = 'crear el pedido';
  setBusy(true);
  try {
    const order = await api<{ data: { id: string; status: string } }>('/api/v1/orders', {
      method: 'POST',
      body: JSON.stringify({ branchId: state.branch.id, tableId: (document.querySelector('#table') as HTMLSelectElement).value || undefined, channel: 'DINE_IN', idempotencyKey: key }),
    });
    for (const line of cartSnapshot) {
      stage = `agregar ${line.product.name}`;
      await api(`/api/v1/orders/${order.data.id}/items`, { method: 'POST', body: JSON.stringify({ productId: line.product.id, variantId: line.variant.id, quantity: line.quantity }) });
    }
    stage = 'confirmar el pedido';
    await api(`/api/v1/orders/${order.data.id}/confirm`, { method: 'POST' });
    stage = 'enviar el pedido a cocina';
    await api(`/api/v1/orders/${order.data.id}/send-to-kitchen`, { method: 'POST', body: JSON.stringify({ idempotencyKey: `${key}-kitchen` }) });
    state.cart = [];
    state.error = '';
    state.loading = false;
    render();
  } catch (error) {
    state.loading = false;
    state.error = `${error instanceof Error ? error.message : 'Error interno del servidor'} al ${stage}. El carrito se conservó.`;
    state.connected = true;
    render();
  }
}
function bindKitchen(): void { document.querySelector('#refresh-kitchen')?.addEventListener('click', loadKitchen); document.querySelectorAll<HTMLButtonElement>('[data-kitchen]').forEach(button => button.onclick = () => changeKitchen(button.dataset.kitchen!, button.dataset.id!)); }
async function loadKitchen(): Promise<void> { if (!state.branch) return; try { const result = await api<{ data: KitchenTicket[] }>(`/api/v1/branches/${state.branch.id}/kitchen/orders`); state.kitchen = await Promise.all(result.data.map(async ticket => (await api<{ data: KitchenTicket }>(`/api/v1/kitchen/orders/${ticket.id}`)).data)); state.kitchenPending = false; state.connected = true; render(); } catch (error) { state.kitchenPending = error instanceof Error && /404|ruta|not found/i.test(error.message); state.connected = !state.kitchenPending; if (!state.kitchenPending) showError(error); else render(); } }
function connectKitchenStream(): void { kitchenStream?.close(); if (!state.branch || state.view !== 'cocina') return; kitchenStream = new EventSource(`/api/v1/branches/${state.branch.id}/kitchen/events`); const refresh = () => loadKitchen(); kitchenStream.addEventListener('order.sent_to_kitchen', refresh); kitchenStream.addEventListener('order.kitchen_status_changed', refresh); kitchenStream.onmessage = refresh; kitchenStream.onerror = () => { kitchenStream?.close(); kitchenStream = undefined; }; }
async function changeKitchen(action: string, id: string): Promise<void> { try { await api(`/api/v1/kitchen/orders/${id}/${action}`, { method: 'POST', body: JSON.stringify({ idempotencyKey: `web-kitchen-${id}-${action}-${crypto.randomUUID()}` }) }); await loadKitchen(); } catch (error) { showError(error); } }
async function loadSession(): Promise<void> { try { const result = await api<{ user: User }>('/api/v1/auth/me'); state.user = result.user; state.loading = false; const branches = await api<{ data: Branch[] }>('/api/v1/branches'); state.branches = branches.data; state.branch = state.branches[0]; state.connected = true; render(); await loadBranchData(); } catch (error) { state.loading = false; showError(error); } }
async function loadBranchData(): Promise<void> { if (!state.branch) return; setBusy(true); try { const [menu, tables] = await Promise.all([api<{ data: Product[] }>(`/api/v1/branches/${state.branch.id}/menu`), api<{ data: Table[] }>(`/api/v1/branches/${state.branch.id}/tables`)]); state.menu = menu.data; state.tables = tables.data; state.connected = true; state.loading = false; render(); if (state.view === 'cocina') { loadKitchen(); connectKitchenStream(); } if (state.view === 'reportes') loadReport(); } catch (error) { state.loading = false; showError(error); } }
window.addEventListener('online', () => { state.connected = true; render(); }); window.addEventListener('offline', () => { state.connected = false; render(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
render(); loadSession();
setInterval(() => { if (state.user && state.view === 'cocina' && state.branch) loadKitchen(); }, 15000);