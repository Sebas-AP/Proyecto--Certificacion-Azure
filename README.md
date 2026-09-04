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

La API queda disponible en `http://localhost:4000` y su comprobación es `GET /health`.

`DATABASE_URL`, `SESSION_SECRET` y `CORS_ORIGIN` deben definirse en `.env`; para desarrollo web usa `CORS_ORIGIN=http://localhost:5173`. Nunca se deben agregar secretos al repositorio.

### Interfaz web / PWA

En otra terminal, con la API disponible:

```bash
npm run dev:web
```

Abre `http://localhost:5173`. Vite redirige `/api` y `/health` a la API en `http://localhost:4000`; las credenciales se envían con la cookie de sesión. Para levantar PostgreSQL, API y PWA en una sola orden usa `npm run dev:all` (requiere `.env` y Docker). El bundle de producción se genera con `npm run build:web` y el build completo con `npm run build:all`.

La aplicación incluye `manifest.webmanifest` y un service worker base. El cache solo cubre el shell estático; las operaciones y datos de menú siempre requieren conexión para evitar pedidos desactualizados.

## Fase 2

Ejecuta las migraciones versionadas en orden con `npm run db:migrate` y carga el administrador de demostración con `SEED_ADMIN_PASSWORD='una-clave-de-12-o-mas' npm run db:seed`.

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

Antes de cargar datos reales deben confirmarse la marca, sucursales, zona horaria, políticas de acceso, retención de datos y responsables de aprobación. Los nombres, precios, horarios, permisos y métodos de pago no se codificarán como reglas fijas.
