#!/usr/bin/env bash
# Testes de ponta a ponta (HTTP + banco) contra PostgreSQL temporário. Uso: bash scripts/test-http.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export MTA_DEV_DB=mta_http_test MTA_DEV_PG_DIR=/tmp/mta-http-pg MTA_DEV_PG_PORT=54331
trap 'bash scripts/pg-local.sh stop >/dev/null 2>&1 || true' EXIT
export MTA_PG_SOCKET=$MTA_DEV_PG_DIR/sock/.s.PGSQL.$MTA_DEV_PG_PORT MTA_PG_DATABASE=$MTA_DEV_DB
export DATA_DIR=/tmp/mta-http-data APP_URL=http://localhost:3199 PORT=3199 NODE_ENV=test
echo "== Ativação dos acessos master (banco vazio) =="
bash scripts/pg-local.sh reset >/dev/null; rm -rf "$DATA_DIR"
bun test tests/activation.test.ts
echo "== Acessos, permissões, arquivos e funções (dados fictícios) =="
bash scripts/pg-local.sh reset >/dev/null; rm -rf "$DATA_DIR"
bun test tests/http.test.ts "$@"
