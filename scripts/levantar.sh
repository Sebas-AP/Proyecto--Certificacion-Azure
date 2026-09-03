#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

if [[ ! -f .env ]]; then
  echo "Falta el archivo .env. Ejecuta: cp .env.example .env"
  exit 1
fi

set -a
source .env
set +a

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker no esta instalado o no esta disponible en PATH."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js/npm no esta instalado o no esta disponible en PATH."
  exit 1
fi

echo "Levantando PostgreSQL..."
docker compose up -d --wait postgres

echo "Aplicando migraciones..."
npm run db:migrate

if [[ -n "${SEED_ADMIN_PASSWORD:-}" ]]; then
  echo "Cargando datos de demostracion..."
  npm run db:seed
else
  echo "Seed omitido. Para cargar el administrador demo:"
  echo "SEED_ADMIN_PASSWORD='una-clave-de-12-o-mas' npm run dev:all"
fi

echo "Iniciando API en http://localhost:4000"
exec npm run dev
