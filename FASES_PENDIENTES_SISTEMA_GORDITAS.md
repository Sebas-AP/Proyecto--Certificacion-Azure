# Fases pendientes de GorditasOS

## Estado actual

Implementado hasta el núcleo de la Fase 7:

- Fase 0: estructura, PostgreSQL, migraciones y ejecución local.
- Fase 1: empresa, sucursales, usuarios, roles, permisos, sesiones y auditoría.
- Fase 2: catálogo, mesas y pedidos.
- Fase 3: PWA de meseros, cocina y eventos SSE.
- Fase 4: caja, pagos, movimientos y reembolsos.
- Fase 5: reportes básicos, exportación CSV y salud operativa.
- Estabilización inicial: CI, pruebas unitarias y health checks.
- Correcciones técnicas: flujo E2E de pedidos resuelto (confirmar pedido con body vacío ya no devuelve 500; se añadió parser de JSON tolerante y pruebas de integración con PostgreSQL: 18 pruebas).
- Fase 7 inicial: ingredientes, unidades, almacenes, existencias, movimientos, recetas versionadas, mermas y conteos.
- Fase 7 UI: pestaña "Inventario" en la PWA con saldos, movimientos, ajustes/compra/mermas, conteos físicos, recetas con versiones y catálogo de ingredientes/almacenes.

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

### Pendiente inmediato

1. Relacionar ingredientes con productos y variantes (receta ya opcionalmente liga productos).
2. Conectar una venta completada con consumo teórico solo después de estabilizar pedidos y pagos.
3. Añadir costos históricos por ingrediente y proveedor (lotes, compras por proveedor, método de costo).
4. Añadir pruebas de concurrencia, transferencias entre almacenes y conversiones de unidades.
5. Recepciones parciales de compra y devoluciones (requiere Fase 8).

### Decisiones necesarias

- Unidades oficiales y conversiones permitidas.
- Si el inventario negativo se bloquea siempre o solo genera alerta.
- Frecuencia de conteos físicos.
- Quién puede ajustar existencias.
- Cómo se manejan lotes, caducidades y productos perecederos.
- Costo promedio, PEPS u otro método.
- Receta vigente al momento de venta.
- Tratamiento de mermas sin costo conocido.

## Fase 8: compras y proveedores

### Alcance

- Proveedores.
- Solicitudes y órdenes de compra.
- Recepciones completas y parciales.
- Diferencias entre pedido y recepción.
- Costos históricos.
- Devoluciones.
- Documentos adjuntos.
- Compras corporativas o por sucursal.

### Dependencias

- Ingredientes y unidades estabilizados.
- Almacenes configurados.
- Proceso de autorización definido.
- Datos reales de proveedores.
- Política de costos aprobada.

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
2. ~~Añadir pruebas de API con PostgreSQL para cada módulo crítico~~ — hechas en `tests/api.integration.test.ts` (18 pruebas) con esquema sembrado por corrida y limpieza autocorrectiva (`purgeTestEnvironments`/`cleanupTestEnvironment`). Cubren autenticación, catálogo, pedidos, cocina, caja, reportes, aislamiento de sucursal/permisos e inventario.
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
4. Completar recetas y conteos en producción (validar con datos reales).
5. Incorporar compras y proveedores.
6. Ejecutar piloto formal.
7. Mejorar reportes con costos y mermas.
8. Desplegar a más sucursales.
9. Implementar pedidos digitales.
10. Evaluar IA con datos históricos.

## Regla de alcance

No implementar WhatsApp, entregas optimizadas ni IA antes de estabilizar pedidos internos, cocina, caja, reportes e inventario básico.
