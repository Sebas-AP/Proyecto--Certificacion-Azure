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

Fase 2 implementada: catálogo, mesas y pedidos. La cocina visual, caja, pagos, inventario, mensajería e IA siguen fuera de alcance.

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

`DATABASE_URL` y `SESSION_SECRET` deben definirse en `.env`; nunca se deben agregar secretos al repositorio.

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

## Decisiones pendientes

Antes de cargar datos reales deben confirmarse la marca, sucursales, zona horaria, políticas de acceso, retención de datos y responsables de aprobación. Los nombres, precios, horarios, permisos y métodos de pago no se codificarán como reglas fijas.
