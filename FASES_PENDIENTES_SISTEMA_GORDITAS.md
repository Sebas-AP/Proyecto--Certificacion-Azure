# Fases pendientes de GorditasOS

## Estado actual

Implementado hasta la Fase 8 completa:

- Fase 0: estructura, PostgreSQL, migraciones y ejecución local.
- Fase 1: empresa, sucursales, usuarios, roles, permisos, sesiones y auditoría.
- Fase 2: catálogo, mesas y pedidos.
- Fase 3: PWA de meseros, cocina y eventos SSE.
- Fase 4: caja, pagos, movimientos y reembolsos.
- Fase 5: reportes básicos, exportación CSV y salud operativa.
- Estabilización inicial: CI, pruebas unitarias y health checks.
- Correcciones técnicas: flujo E2E de pedidos resuelto (confirmar pedido con body vacío ya no devuelve 500; se añadió parser de JSON tolerante y pruebas de integración con PostgreSQL: 29 pruebas).
- Fase 7 inicial: ingredientes, unidades, almacenes, existencias, movimientos, recetas versionadas, mermas y conteos.
- Fase 7 UI: pestaña "Inventario" en la PWA con saldos, movimientos, ajustes/compra/mermas, conteos físicos, recetas con versiones y catálogo de ingredientes/almacenes.
- Fase 7 consolidada: consumo teórico al completar venta, transferencias entre almacenes, conversiones de unidades y pruebas de concurrencia.
- Fase 8 núcleo: proveedores, órdenes de compra, recepciones completas y parciales y costos históricos.
- Fase 8 completa: devoluciones de compra (`return`), diferencias de precio en recepción (`unitPrice`), costos consultables (`GET /inventory/costs`, promedio simple ponderado por unidad base) y tab "Compras" en la PWA. Migración `009_purchasing_returns.sql` y 31 pruebas de integración.

## Pendiente conocido

El flujo visual de creación y envío de pedidos reportaba errores intermitentes en el entorno local; se diagnosticó y corrigió la causa raíz (confirmación de pedido sin cuerpo JSON producía un 500). Queda pendiente una prueba E2E con navegador automatizado como red de seguridad adicional. No conectar el consumo teórico de inventario con pedidos hasta completar esa prueba.

## Fase 7: completar inventario y costos

### Tras 2026-09-05 (backend, seed demo y UI de inventario)

- [x] Interfaz administrativa para ingredientes, unidades y almacenes (tab Inventario > Catálogo).
- [x] Interfaz para saldos y movimientos de inventario (tab Inventario > Saldos y Movimientos).
- [x] Interfaz para recetas y versiones (tab Inventario > Recetas; detalle por versión vía `GET /api/v1/recipe-versions/:id`).
- [x] Flujo de conteo físico y conciliación (tab Inventario > Conteos).
- [x] Flujo de mermas con motivo (formulario de merma en Movimientos).
- [x] Compras registradas como movimiento `PURCHASE` y recepción inicial verificada (endpoint y UI).
- [x] Unidades expuestas a la UI (`GET /api/v1/units`; globales + de empresa).
- [x] Balances muestran ingredientes sin existencias en cero (`GET /api/v1/inventory/balances` hace left join).
- [x] Seed demo idempotente con 4 ingredientes, almacén, compra inicial y receta v1 con 4 ingredientes; se eliminaron empresas demo duplicadas.

### Tras 2026-09-05 (pendientes de Fase 7: consumo, transferencias, conversiones y concurrencia)

- [x] Migración `007_inventory_consumption.sql`: se quitó el `CHECK (quantity >= 0)` de `stock_balances` y se agregó `idempotency_key` a `stock_movements` con índice único por par `(idempotency_key, movement_type)`.
- [x] Consumo teórico al completar venta: cuando un pago liquida el pedido (`status=COMPLETED`), se descuentan los ingredientes de la receta vigente del producto vendido como movimientos `THEORETICAL_CONSUMPTION` (en `apps/api/src/inventory-consumption.ts`, disparado desde `cash-payments.ts`). Toma el primer almacén activo de la sucursal; sin receta o sin almacén no se descuenta (no bloquea la venta).
- [x] Decisión resuelta: inventario negativo permitido **solo** para `THEORETICAL_CONSUMPTION`; el resto de movimientos sigue bloqueando con `409`.
- [x] Conversiones de unidades: `GET/POST /api/v1/unit-conversions` (factor = unidades destino por unidad origen; por empresa o globales). Se aplican en el consumo teórico cuando la unidad de la receta difiere de la unidad base del ingrediente; sin conversión definida se omite esa línea sin bloquear.
- [x] Transferencias entre almacenes: `POST /api/v1/inventory/transfers` atómico, con par `TRANSFER_OUT`/`TRANSFER_IN`, `reference_id` compartido y `idempotency_key` para reintentos; valida misma sucursal y almacenes activos; rechaza origen insuficiente con `409`.
- [x] Pruebas de concurrencia en `tests/api.integration.test.ts` (24 pruebas): pagos concurrentes completan el pedido exactamente una vez; transferencias concurrentes no sobrepasan el origen; consumo idempotente y con saldo negativo; conversiones aplicadas.
- [x] `tests/support.ts` limpia ahora `unit_conversions` por empresa y migra hasta `007`; `package.json` `db:migrate` incluye `007`.

### Tras 2026-09-05 (Fase 8: compras y proveedores, núcleo backend)

- [x] Migración `008_purchasing.sql`: `suppliers` (con `UNIQUE(company_id,name)` e índice por `tax_id`), `branch_purchase_sequences`, `purchase_orders` (folio por sucursal, estados `DRAFT`/`PARTIALLY_RECEIVED`/`RECEIVED`/`CANCELLED`, idempotencia por `(company,branch,idempotency_key)`), `purchase_order_items` (con `received_quantity` para diferencias), `purchase_receipts` (con `warehouse_id` y `idempotency_key` única), `purchase_receipt_items` e `ingredient_costs` (costos históricos `PURCHASE`/`ADJUSTMENT`). Permisos nuevos: `purchase.read`, `purchase.manage`, `purchase.receive`.
- [x] Proveedores: `GET/POST /api/v1/suppliers` (creación con 409 ante duplicado).
- [x] Órdenes de compra: `GET/POST /api/v1/purchase-orders` (lista con filtro de estado, detalle con ítems y recepciones) y `POST /api/v1/purchase-orders/:id/cancel` (solo en borrador). Al crear, si la unidad del ítem difiere de la unidad base exige una conversión definida (400 en caso contrario).
- [x] Recepciones completas y parciales: `POST /api/v1/purchase-orders/:id/receive` con `warehouseId`, `idempotencyKey` y líneas `{ingredientId, quantityReceived}`. En la misma transacción crea la recepción, incrementa `received_quantity` por línea, registra movimientos `PURCHASE` (con `reference_id` de la recepción, cantidad en unidad del pedido y `signedDelta` en unidad base vía conversión), escribe asientos en `ingredient_costs` con el `unit_price` de la orden y avanza el estado a `PARTIALLY_RECEIVED`/`RECEIVED`. Rechaza con `409` recepcionar más de lo pedido, líneas ya completas u órdenes `RECEIVED`/`CANCELLED`; el reintento con la misma `idempotency_key` devuelve la recepción previa sin duplicar existencias.
- [x] Pruebas de integración (29 en total): proveedor con control de permisos, orden idempotente, recepción parcial → existencias y costos históricos, sobre-recepción y reposición rechazadas (409), y recepción en unidad distinta (G) con conversión a base (KG) idempotente.
- [x] `tests/support.ts` migra hasta `008` y limpia las tablas de compras; `package.json` `db:migrate` incluye `008`; el seed demo crea un proveedor de demostración.

### Tras 2026-09-05 (Fase 8 completada: devoluciones, diferencias de precio, costos y UI)

- [x] Migración `009_purchasing_returns.sql`: el `CHECK` de `stock_movements` admite el tipo `RETURN`; tablas `purchase_returns` y `purchase_return_items` (con idempotencia por `idempotency_key`); `ingredient_costs` gana `quantity_base` y `total_cost` para el costo promedio.
- [x] Recepción con diferencias de precio: `POST /purchase-orders/:id/receive` acepta `unitPrice` opcional por línea; el precio efectivo (`item.unitPrice ?? unit_price` de la orden) se guarda en `purchase_receipt_items` e `ingredient_costs` (`total_cost = unitPrice × cantidad`).
- [x] Devoluciones: `POST /purchase-orders/:id/return` con `warehouseId`, `idempotencyKey` y líneas `{ingredientId, quantityReturned}`. Valida que no se devuelva más de lo recibido ni ya devuelto (409), registra `purchase_returns`, movimientos `RETURN` (negativos en unidad base) y auditoría; reintento idempotente 200. El detalle de la orden expone `returns` y `lines[].returned_quantity`.
- [x] Costos consultables: `GET /api/v1/inventory/costs?branchId=&ingredientId=` (permiso `inventory.read`) devuelve por ingrediente el último costo (`last_price`/`last_unit`/`last_at`) y el **costo promedio simple**: `average_cost_per_base_unit = SUM(total_cost)/SUM(quantity_base)`.
- [x] UI de compras en la PWA (tab Inventario > Compras): registro de proveedores, creación de órdenes de compra con líneas (ingrediente/cantidad/unidad/precio), lista y apertura de órdenes, recepción parcial con almacén, devolución con almacén y tabla de costos por ingrediente.
- [x] Pruebas de integración (31 en total): devolución idempotente que devuelve existencias (saldo final, movimiento `RETURN`, detalle con `returned_quantity`) y diferencia de precio + costo promedio (`unitPrice` de recepción respetado, `average_cost_per_base_unit` calculado).
- [x] `tests/support.ts` migra hasta `009` y limpia `purchase_return_items`/`purchase_returns`; `package.json` `db:migrate` incluye `009`.

### Pendiente inmediato

1. Relacionar ingredientes con productos y variantes (receta ya opcionalmente liga productos).
2. ~~Conectar una venta completada con consumo teórico~~ — hecho: consumo teórico al liquidar el pago, con saldo negativo permitido solo en ese tipo de movimiento.
3. ~~Costos históricos por ingrediente~~ — hecho: se registran en `ingredient_costs` y se consultan vía `GET /inventory/costs` con promedio simple ponderado por unidad base; falta mostrarlos en reportes de Fase 9 y conectar el costo de mermas/consumo.
4. ~~Añadir pruebas de concurrencia, transferencias entre almacenes y conversiones de unidades~~ — hecho: endpoints y pruebas de integración agregadas.
5. ~~Recepciones parciales de compra y diferencias de precio~~ — hechas en el núcleo de Fase 8; devoluciones y `unitPrice` por recepción completados en la Fase 8.

### Decisiones necesarias

- Unidades oficiales y conversiones permitidas (por ahora se definen por empresa vía `unit-conversions`).
- ~~Si el inventario negativo se bloquea siempre o solo genera alerta~~ — resuelto: se permite negativo solo en consumo teórico (`THEORETICAL_CONSUMPTION`); el resto bloquea con `409`.
- Frecuencia de conteos físicos.
- Quién puede ajustar existencias.
- Cómo se manejan lotes, caducidades y productos perecederos.
- Costo promedio, PEPS u otro método: resuelto en Fase 8 con **promedio simple ponderado por unidad base** (`SUM(total_cost)/SUM(quantity_base)`); PEPS o último costo son mejoras posteriores.
- Receta vigente al momento de venta.
- Tratamiento de mermas sin costo conocido.

## Fase 8: compras y proveedores

### Alcance

- Proveedores: hecho (endpoints + seed demo).
- Solicitudes y órdenes de compra: hecho el backend (creación, consulta, cancelación en borrador).
- Recepciones completas y parciales: hecho el backend (con `idempotency_key`, estado `PARTIALLY_RECEIVED`/`RECEIVED` y movimientos `PURCHASE`).
- Diferencias entre pedido y recepción: recibir más de lo pedido se rechaza con `409`; la diferencia (cantidad pendiente) queda en `received_quantity`. El precio efectivo por línea puede diferir del pedido (`unitPrice` opcional en la recepción) y queda registrado en `ingredient_costs`.
- Costos históricos: hecho — registro en `ingredient_costs` al recibir y consulta vía `GET /inventory/costs` con costo promedio simple ponderado por unidad base.
- Devoluciones: hecho — `POST /purchase-orders/:id/return` con validación contra recibido/devuelto, movimientos `RETURN` y UI.
- Documentos adjuntos: pendiente.
- Compras corporativas o por sucursal: órdenes por sucursal hechas; corporativas pendiente.

### Dependencias

- Ingredientes y unidades estabilizados: cumplido (Fase 7).
- Almacenes configurados: cumplido.
- Proceso de autorización definido: pendiente si se quiere aprobación de órdenes (hoy solo borrador → recepción directa).

## Fase 9: piloto operativo formal

### Antes de abrir

- Confirmar sucursal piloto, dispositivos e impresoras.
- Cargar menú real y precios aprobados.
- Validar horarios, impuestos y métodos de pago.
- Crear usuarios reales por rol.
- Capacitar meseros, cocina, caja y gerente.
- Ejecutar simulación de apertura, pedido, cocina, cobro y cierre.
- Probar reinicio de dispositivos y pérdida de conexión.
- Preparar soporte para horas pico.
- Mantener proceso manual de reversión.

### Criterios de autorización

- API y base de datos con health check correcto.
- Migraciones repetibles.
- Build y pruebas verdes.
- No perder ni duplicar pedidos en pruebas E2E.
- Caja conciliable.
- Reportes consistentes con pedidos pagados.
- Personal capacitado.
- Responsable de soporte asignado.
- Datos originales de Excel preservados.

## Fase 10: despliegue multisucursal

- Incorporar una sucursal adicional por vez.
- Validar aislamiento de datos y permisos.
- Configurar horarios y disponibilidad por sucursal.
- Comparar ventas y cierres contra el proceso anterior.
- Mantener periodo de soporte intensivo.
- No activar inventario avanzado en todas las sucursales sin datos confiables.

## Fase 11: pedidos digitales y entregas

- Clientes y direcciones.
- Pedidos para llevar y domicilio.
- Repartidores.
- Estados de entrega.
- Zonas y costos.
- Adaptador de mensajería oficial.
- Confirmación explícita del cliente.
- Escalamiento humano.
- Protección de teléfonos y direcciones.

No iniciar esta fase hasta que pedidos internos, caja y reportes estén estables.

## Fase 12: analítica e inteligencia artificial

### Datos mínimos

- Al menos varios meses de ventas consistentes.
- Catálogo y precios históricos confiables.
- Disponibilidad registrada.
- Recetas y unidades estandarizadas.
- Mermas y compras capturadas.
- Correcciones y cancelaciones auditadas.

### Casos posibles

- Pronóstico de ventas.
- Pronóstico de ingredientes.
- Sugerencias de compra.
- Detección de anomalías.
- Interpretación de pedidos libres.
- Análisis de comentarios.

Toda recomendación debe ser revisable, desactivable y aprobada por una persona.

## Correcciones técnicas pendientes

1. ~~Resolver el flujo E2E de pedidos desde la PWA~~ — resuelto: la confirmación de pedido se enviaba con `Content-Type: application/json` y cuerpo vacío, y Fastify devolvía 500 (`FST_ERR_CTP_EMPTY_JSON_BODY`). Se agregó parser de JSON tolerante en `apps/api/src/app.ts` (cuerpo vacío → `{}`, JSON inválido → 400) y se corrigió la PWA para no enviar `Content-Type` sin cuerpo.
2. ~~Añadir pruebas de API con PostgreSQL para cada módulo crítico~~ — hechas en `tests/api.integration.test.ts` (29 pruebas) con esquema sembrado por corrida y limpieza autocorrectiva (`purgeTestEnvironments`/`cleanupTestEnvironment`). Cubren autenticación, catálogo, pedidos, cocina, caja, reportes, aislamiento de sucursal/permisos e inventario (incluidos consumo teórico, transferencias, conversiones, concurrencia y compras/proveedores).
3. Añadir pruebas E2E con navegador.
4. Reemplazar el bus SSE en memoria cuando existan réplicas.
5. Agregar rate limiting y protección contra fuerza bruta.
6. Añadir OpenAPI generado y versionado.
7. Configurar respaldos y prueba de restauración.
8. Configurar monitoreo y alertas de producción.
9. ~~Revisar datos demo y limpiar duplicados antes de producción~~ — se consolidó una sola empresa demo (queda `admin@demo.local`) y el seed ahora incluye inventario inicial demo; seguir revisando antes de producción.
10. Definir estrategia de migraciones para despliegues reales.

## Orden recomendado de continuación

1. ~~Resolver y probar pedidos E2E~~ — resuelto a nivel API; añadir prueba E2E con navegador.
2. ~~Añadir pruebas de caja y pedidos con base real~~ — cubiertas en la suite de integración.
3. ~~Construir interfaz de inventario~~ — pestaña Inventario funcional (saldos, movimientos, ajustes, mermas, conteos, recetas, catálogo).
4. ~~Completar pendientes de Fase 7~~ — consumo teórico al completar venta, transferencias entre almacenes, conversiones de unidades y pruebas de concurrencia ya implementados y probados.
5. Completar recetas y conteos en producción (validar con datos reales).
6. ~~Incorporar compras y proveedores~~ — Fase 8 completa: proveedores, órdenes de compra, recepciones completas/parciales, devoluciones, diferencias de precio, costos promedio y UI de compras.
7. Ejecutar piloto formal.
8. Mejorar reportes con costos y mermas.
9. Desplegar a más sucursales.
10. Implementar pedidos digitales.
11. Evaluar IA con datos históricos.

## Regla de alcance

No implementar WhatsApp, entregas optimizadas ni IA antes de estabilizar pedidos internos, cocina, caja, reportes e inventario básico.
