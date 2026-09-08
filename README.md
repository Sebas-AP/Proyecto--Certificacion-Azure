# GorditasOS

Base inicial de la plataforma multisucursal para la cadena de restaurantes de gorditas.

## Estado

Implementada la Fase 0 y el primer núcleo de la Fase 1:

- API REST en Fastify y TypeScript.
- PostgreSQL con migración inicial.
- Empresas, sucursales, usuarios, roles, permisos, asignaciones, sesiones, turnos y auditoría.
- Autenticación por sesión en cookie `HttpOnly`.
- Autorización por permiso y pertenencia a sucursal.
- Prueba unitaria inicial del dominio de permisos.

Fase 2 implementada: catálogo, mesas y pedidos. La primera interfaz operativa de Fase 3 vive en `apps/web`: meseros, sesión por cookie, pedidos enviados a cocina y una vista de cocina preparada para su contrato de tickets. Caja, pagos, inventario, mensajería e IA siguen fuera de alcance.

El seed demo es idempotente. Con `SEED_ADMIN_PASSWORD` crea o actualiza la empresa `Empresa de demostracion`, las sucursales `Sucursal piloto` (`PILOTO`) y `Sucursal Alameda` (`ALAMEDA`) con horario de atención 07:00–22:00 los 7 días (Alameda limita el frijol a 08:00–14:00), el usuario `admin@demo.local` y su rol Administrador con todos los permisos disponibles. También crea la categoría `Gorditas`, tres productos demo con dos variantes y precios vigentes cada uno, disponibilidad en ambas sucursales, mesas, una caja principal por sucursal, los métodos de pago efectivo, tarjeta y transferencia, e inventario inicial: un almacén principal, cuatro ingredientes (masa, chicharrón, salsa y queso) con compra inicial, y la receta `Gordita de chicharron` v1. Para Fase 11 añade un cliente demo (Lupita López) con una dirección, la zona de entrega `Centro` ($25) y un repartidor. No crea pedidos, pagos, turnos ni otros datos históricos.

Fase 4 implementada: sesiones de caja, pagos mixtos en efectivo/tarjeta/transferencia, cierres, idempotencia, movimientos manuales `IN/OUT`, solicitudes/aprobaciones de reembolso y consulta de pedidos pendientes. No se almacenan datos de tarjetas.

Fase 5 piloto implementada: reportes básicos de ventas y operación, con filtros UTC explícitos, aislamiento por empresa/sucursales autorizadas y exportación CSV auditada. La fase siguiente añade el núcleo backend de inventario y recetas; compras completas, WhatsApp e IA siguen fuera de alcance.

Fase 6-8 implementadas: núcleo backend de inventario y recetas (productos/ingredientes/almacenes, recetas, consumos teóricos, transferencias, conversiones, conteos y catálogo de unidades), interfaz PWA de inventario y compras/proveedores (órdenes de compra, recepciones completas/parciales, devoluciones, diferencias de precio y costos promedio). Fase 9: la PWA quedó verificada de punta a punta con Playwright (6/6) e informe piloto.

Fase 10 (núcleo técnico) implementada: incorporación de sucursales desde la API y la PWA (pestaña Sucursales), horarios de atención por sucursal (7 días, sin filas = 24/7) y ventanas de disponibilidad por producto, ambos con permiso `schedule.manage`. El menú reporta `openNow`/`available_now` y la operación bloquea (409) pedidos o envíos a cocina cuando la sucursal está cerrada o el producto está fuera de ventana.

Fase 11 (núcleo técnico) implementada: pedidos digitales y entregas. Clientes y direcciones con PII protegida (teléfonos/calles enmascarados salvo `customer.manage`), pedidos `TAKEOUT`/`DELIVERY` con costo de zona duplicado (`delivery_fee`), repartidores (`INTERNAL`/`EXTERNAL`), estados de entrega (`COURIER_ASSIGNED`→`OUT_FOR_DELIVERY`→`DELIVERED`) con cola de despacho, confirmación explícita del cliente por token (`POST /orders/confirm-by-token`, idempotente) y escalamiento humano (`flag-attention`).

## Requisitos

- Node.js 22 o posterior.
- Docker y Docker Compose.
- PostgreSQL 17 si no se usa Compose.

## Inicio local

### Comando unico

Despues de crear `.env`, puedes levantar PostgreSQL, aplicar migraciones, cargar datos demo opcionalmente e iniciar la API con:

```bash
cp .env.example .env
SEED_ADMIN_PASSWORD='AdminDemo2026!' npm run dev:all
```

Para iniciar sin cargar datos demo:

```bash
npm run dev:all
```

El script deja PostgreSQL ejecutandose y mantiene la API en primer plano. Detenla con `Ctrl+C`; para detener tambien PostgreSQL usa `docker compose down`.

### Pasos manuales

```bash
cp .env.example .env
npm install
npm run build
docker compose up -d postgres
npm run db:migrate
npm run dev
```

La API queda disponible en `http://localhost:4000`. Sus comprobaciones de salud son `GET /health/live` (proceso activo, sin base de datos) y `GET /health/ready` (PostgreSQL disponible). `GET /health` se conserva como alias compatible de `live`.

`DATABASE_URL`, `SESSION_SECRET` y `CORS_ORIGIN` deben definirse en `.env`; para desarrollo web usa `CORS_ORIGIN=http://localhost:5173`. Nunca se deben agregar secretos al repositorio.

## CI

GitHub Actions ejecuta CI en cada `push` y `pull request` con Node.js 22. El job
principal instala dependencias con `npm ci`, ejecuta `npm run build:all` y
`npm test`, usando la cache de npm. Un job separado levanta PostgreSQL 17 y
ejecuta `npm run db:migrate` dos veces para comprobar que las migraciones son
repetibles. Un tercer job (`integration`) levanta PostgreSQL 17 como servicio y
ejecuta `npm run test:integration`. No requiere secretos ni realiza despliegues.

Localmente, las pruebas de integración `npm run test:integration` usan el
PostgreSQL de `docker compose` y siembran una empresa de prueba por corrida
(`tests/support.ts`), con limpieza automática que desactiva temporalmente los
triggers de inmutabilidad de pagos e inventario. El job `integration` del CI
replica esa configuración con un servicio PostgreSQL.

### Interfaz web / PWA

En otra terminal, con la API disponible:

```bash
npm run dev:web
```

Abre `http://localhost:5173`. Vite redirige `/api` y `/health` a la API en `http://localhost:4000`; las credenciales se envían con la cookie de sesión. Para levantar PostgreSQL, API y PWA en una sola orden usa `npm run dev:all` (requiere `.env` y Docker). El bundle de producción se genera con `npm run build:web` y el build completo con `npm run build:all`.

La aplicación incluye `manifest.webmanifest` y un service worker base. El cache solo cubre el shell estático; las operaciones y datos de menú siempre requieren conexión para evitar pedidos desactualizados.

### Pruebas E2E (Playwright)

Requiere la API, la PWA (`npm run dev:web`) y PostgreSQL demo levantados, y Chromium del sistema (`/usr/bin/chromium`). Ejecutar dentro de la ventana de atención demo (07:00–22:00 hora local de la sucursal), porque desde la Fase 10 la sucursal bloquea pedidos fuera de horario.

```bash
npm run test:e2e        # suite mesero → cocina → caja → inventario → reportes
npm run report:fase9    # genera reports/Fase9_Informe_Piloto_Operativo.docx con las capturas
```

El eje es `tests/e2e/flujo-operativo.spec.ts` (6 pruebas en serie): inicia sesión, toma un pedido, lo envía a cocina, lo marca listo, lo cobra en caja y verifica contra PostgreSQL el descuento de inventario, la cadena de eventos, la unicidad de pagos y los reportes. Cada paso deja una captura en `reports/e2e/capturas/` y las evidencias en `reports/e2e/resultados.json`.

## Fase 2

Ejecuta las migraciones versionadas en orden, incluida caja y pagos, con `npm run db:migrate` y carga el administrador de demostración con `SEED_ADMIN_PASSWORD='una-clave-de-12-o-mas' npm run db:seed`.

Endpoints autenticados principales:

- `GET/POST /api/v1/categories` y `GET/POST /api/v1/products`
- `GET /api/v1/branches/:branchId/menu` y `PATCH /api/v1/branches/:branchId/products/:productId/availability`
- `GET /api/v1/branches/:branchId/tables` y `POST /api/v1/tables`
- `POST /api/v1/orders`, `POST /api/v1/orders/:id/items`, `POST /api/v1/orders/:id/confirm`
- `POST /api/v1/orders/:id/send-to-kitchen`, `GET /api/v1/orders/:id`, `GET /api/v1/orders/:id/events`
- `POST /api/v1/orders/:id/cancellation-request` con `{ "reason": "..." }`

La creación de pedidos requiere `idempotencyKey`; el envío a cocina también. Los precios se copian al detalle, el folio es incremental por sucursal y los cambios sensibles generan auditoría.

## Contrato esperado de Fase 3: cocina

La API de cocina existente expone estas rutas. La vista las consume sin datos comerciales fijos:

- `GET /api/v1/branches/:branchId/kitchen/orders` lista pedidos con `kitchen_status`.
- `GET /api/v1/kitchen/orders/:id` devuelve el detalle de la comanda y sus artículos.
- `POST /api/v1/kitchen/orders/:id/start` y `/ready` reciben `{ "idempotencyKey": "..." }` y validan permiso y pertenencia a sucursal.
- `GET /api/v1/branches/:branchId/kitchen/events` ofrece SSE (`text/event-stream`) para avisos de cambios. El frontend deja polling de 15 segundos como fallback.

Estados que consume la interfaz: `PENDING`, `IN_PROGRESS` y `READY`. La acción separada `accept` solicitada para Fase 3 aún no existe en la API actual; la interfaz inicia directamente una comanda pendiente. No se añadió ninguna ruta backend adicional.

## Decisiones pendientes

## Fase 3: cocina

Endpoints autenticados, limitados a la empresa y sucursal asignada al usuario:

- `GET /api/v1/branches/:branchId/kitchen/orders` lista comandas pendientes.
- `GET /api/v1/kitchen/orders/:id` consulta el detalle y sus modificadores.
- `POST /api/v1/kitchen/orders/:id/start` cambia `PENDING` a `IN_PROGRESS`.
- `POST /api/v1/kitchen/orders/:id/ready` cambia `IN_PROGRESS` a `READY`.
- `GET /api/v1/branches/:branchId/kitchen/events` abre un stream SSE.

Las transiciones requieren `kitchen.manage` y un `idempotencyKey`; la consulta y SSE requieren `kitchen.read`. El envío existente publica `order.sent_to_kitchen` y las transiciones publican `order.kitchen_status_changed`. El SSE usa memoria del proceso: no es un bus distribuido entre réplicas y no recupera eventos perdidos durante una desconexión; la pantalla debe volver a consultar la lista.

## Fase 4: caja y pagos

Endpoints autenticados y aislados por empresa y sucursal asignada:

- `POST /api/v1/branches/:branchId/cash-sessions/open` con `{ "openingCash": 500, "cashRegisterId": "..." }`.
- `GET /api/v1/branches/:branchId/cash-sessions/current` devuelve la sesión abierta.
- `POST /api/v1/cash-sessions/:id/movements` registra movimientos `IN/OUT` con motivo.
- `GET /api/v1/orders/:id/payments` consulta los pagos del pedido.
- `POST /api/v1/orders/:id/payments` recibe `{ "method": "CASH|CARD|TRANSFER", "amount": 100, "cashReceived": 100, "idempotencyKey": "..." }`.
- `POST /api/v1/cash-sessions/:id/close` recibe `{ "countedCash": 500, "closingNote": "..." }`.

La suma de pagos no puede sobrepasar el total. La orden pasa a `COMPLETED` solo cuando se cubre exactamente, y los pagos concurrentes bloquean la orden con `SELECT FOR UPDATE`. Permisos: `cash.read`, `cash.open`, `cash.charge` y `cash.close`. La API devuelve `401` para sesión ausente, `403` para permisos o sucursal, y `409` para conflictos de caja o pago.

Antes de cargar datos reales deben confirmarse la marca, sucursales, zona horaria, políticas de acceso, retención de datos y responsables de aprobación. Los nombres, precios, horarios, permisos y métodos de pago no se codificarán como reglas fijas.

## Fase 5: piloto y reportes básicos

Los reportes requieren autenticación y fechas obligatorias en formato `YYYY-MM-DD`; `dateTo` es exclusivo y se interpreta a medianoche UTC. La base de datos almacena y filtra `TIMESTAMPTZ` en UTC.

- `GET /api/v1/reports/sales-summary?dateFrom=2026-09-01&dateTo=2026-09-05` devuelve ventas de pedidos `COMPLETED`, pedidos pagados, ticket promedio, importes por `CASH/CARD/TRANSFER` y pedidos `CANCELLED`.
- `GET /api/v1/reports/sales-summary.csv?...` exporta el mismo resumen como CSV con `Content-Disposition`; la exportación genera auditoría.
- `GET /api/v1/reports/operations-summary?...` devuelve pedidos abiertos, comandas pendientes, comandas retrasadas (más de 15 minutos), mesas ocupadas/abiertas y productos no disponibles.

Permisos: una consulta con `branchId` requiere `report.branch.read`; una consulta sin sucursal requiere `report.company.read` y solo agrega sucursales asignadas al usuario. La exportación requiere además `export.read`.

## Fase 6: inventario y recetas (backend)

La migración `006_inventory.sql` es repetible y crea unidades, conversiones, ingredientes, almacenes, existencias, movimientos inmutables, recetas versionadas, mermas y conteos. Las existencias usan `NUMERIC(20,8)` y las modificaciones bloquean el balance con `SELECT FOR UPDATE`. La migración `007_inventory_consumption.sql` agrega `idempotency_key` a los movimientos y permite balance negativo **solo** para consumo teórico; el resto de operaciones responde `409` ante negativo.

Endpoints autenticados:

- `GET /api/v1/units` lista unidades globales y de la empresa para formularios.
- `GET/POST /api/v1/unit-conversions` define factores de conversión por empresa (`factor` = unidades destino por unidad origen; p. ej. KG→G = 1000).
- `GET/POST /api/v1/ingredients` y `GET/POST /api/v1/warehouses`.
- `GET /api/v1/inventory/balances?branchId=...` y `GET /api/v1/inventory/movements?branchId=...&ingredientId=...`. Los balances hacen left join con ingredientes para mostrar existencias en cero.
- `POST /api/v1/inventory/adjustments` con `type`, `quantity`, `unitId` y motivo obligatorio; `POST /api/v1/inventory/waste` registra merma y movimiento.
- `POST /api/v1/inventory/transfers` mueve existencia entre dos almacenes de la misma sucursal de forma atómica (par `TRANSFER_OUT`/`TRANSFER_IN` con `reference_id` compartido), es idempotente por `idempotencyKey` y rechaza con `409` si el origen no tiene saldo.
- `GET/POST /api/v1/recipes` y `POST /api/v1/recipes/:id/versions`, que nunca sobrescribe versiones existentes.
- `GET /api/v1/recipe-versions/:id` devuelve una versión con sus ingredientes (para consulta visual).
- `POST /api/v1/inventory/counts` y `POST /api/v1/inventory/counts/:id/result`.

Permisos: `inventory.read`, `inventory.manage`, `inventory.adjust`, `recipe.read` y `recipe.manage`. Los ajustes, mermas, cambios de receta, transferencias y conteos generan auditoría.

**Consumo teórico al completar venta**: cuando un pago liquida el total de un pedido (estado `COMPLETED`), se descuentan los ingredientes de la receta vigente de cada producto vendido como movimientos `THEORETICAL_CONSUMPTION` (se toma el primer almacén activo de la sucursal; sin receta o sin almacén no se descuenta y no se bloquea la venta). Si la unidad de la receta difiere de la unidad base del ingrediente se aplica la conversión de `unit-conversions`; sin conversión definida se omite esa línea. El saldo puede quedar negativo solo con consumos teóricos; los demás movimientos siguen bloqueando con `409`.

## Fase 7: interfaz de inventario (PWA)

La pestaña `Inventario` se autentica con la misma sesión y agrupa cinco subvistas:

- **Saldos**: existencias por almacén, con ingredientes en cero cuando no hay movimientos.
- **Movimientos**: histórico filtrable por ingrediente y formularios de ajuste/compra (`PURCHASE`, `POSITIVE_ADJUSTMENT`, `NEGATIVE_ADJUSTMENT`) y de merma (`WASTE`).
- **Conteos**: inicia un conteo por almacén, captura el resultado por ingrediente y completa el conteo.
- **Recetas**: crea recetas con lista de ingredientes y abre nuevas versiones sin sobrescribir las anteriores; el detalle de una versión se consulta con `GET /api/v1/recipe-versions/:id`.
- **Catálogo**: alta y listado de ingredientes (con unidad base) y almacenes de la sucursal activa.

Los consumos teóricos de las ventas completadas y las transferencias entre almacenes aparecen en el histórico de **Movimientos**. Los permisos degradan la interfaz de forma natural: un rol sin `inventory.*` o `recipe.*` verá los errores `403` de la API. Los datos demo se cargan con `npm run db:seed` (ver apartado de seed) y se limpiaron las empresas demo duplicadas de corridas previas.

## Fase 8: compras y proveedores

La migración `008_purchasing.sql` crea proveedores, secuencias de orden por sucursal, órdenes de compra (estados `DRAFT`/`PARTIALLY_RECEIVED`/`RECEIVED`/`CANCELLED` e idempotencia por `idempotency_key`), ítems con cantidad recibida (`received_quantity`), recepciones por almacén con `idempotency_key` única y el histórico de costos `ingredient_costs`. La migración `009_purchasing_returns.sql` extiende el check de `stock_movements` con el tipo `RETURN`, crea `purchase_returns`/`purchase_return_items` y añade `quantity_base`/`total_cost` a `ingredient_costs` (base del costo promedio). Permisos nuevos: `purchase.read`, `purchase.manage` y `purchase.receive`.

Endpoints autenticados:

- `GET/POST /api/v1/suppliers` listan y crean proveedores por empresa (409 ante duplicado por nombre).
- `GET /api/v1/purchase-orders?branchId=...&status=...` lista órdenes con nombre del proveedor; `GET /api/v1/purchase-orders/:id` trae detalle con ítems, recepciones, devoluciones y `lines[].returned_quantity`.
- `POST /api/v1/purchase-orders` crea una orden con `{ branchId, supplierId, idempotencyKey, items: [{ ingredientId, quantity, unitId, unitPrice }] }`. Si la unidad del ítem difiere de la unidad base del ingrediente se exige una conversión definida en `unit-conversions`.
- `POST /api/v1/purchase-orders/:id/receive` registra una recepción completa o parcial con `{ warehouseId, idempotencyKey, items: [{ ingredientId, quantityReceived, unitPrice? }] }`. En la misma transacción acumula `received_quantity`, registra movimientos `PURCHASE` (referenciando la recepción; cantidad en la unidad del pedido y saldo en unidad base vía conversión) y escribe asientos en `ingredient_costs` (`total_cost = unitPrice × cantidad`). El precio efectivo de cada línea es `unitPrice` si se envía en la recepción, o el `unit_price` de la orden en caso contrario. Avanza a `PARTIALLY_RECEIVED` o `RECEIVED`. Recibir más de lo pedido, líneas ya completas u órdenes `RECEIVED`/`CANCELLED` responden `409`; reintentar con la misma `idempotency_key` devuelve la recepción previa sin duplicar existencias.
- `POST /api/v1/purchase-orders/:id/return` registra una devolución de una orden ya recibida (no `DRAFT`/`CANCELLED`) con `{ warehouseId, idempotencyKey, items: [{ ingredientId, quantityReturned }] }`. Devuelve existencias a la puerta (movimientos `RETURN` negativos), valida que no se devuelva más de lo recibido ni ya devuelto (409 siempre que el ítem haya sido devuelto) y es idempotente.
- `POST /api/v1/purchase-orders/:id/cancel` cancela una orden solo en `DRAFT`.
- `GET /api/v1/inventory/costs?branchId=...&ingredientId=...` (permiso `inventory.read`) devuelve por ingrediente el último costo (`last_price`/`last_unit`/`last_at`) y el costo promedio simple ponderado por unidad base: `average_cost_per_base_unit = SUM(total_cost)/SUM(quantity_base)`.

Las órdenes, recepciones, devoluciones y cancelaciones generan auditoría. El seed demo crea el proveedor "Proveedor de demostracion". La PWA expone el flujo completo en **Inventario > Compras**: registro de proveedores, creación de órdenes con líneas, recepción parcial y devolución con almacén, y tabla de costos por ingrediente.
