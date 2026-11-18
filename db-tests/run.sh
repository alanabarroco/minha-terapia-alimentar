#!/usr/bin/env bash
# Executa as migrações reais + dados fictícios + testes de autorização num PostgreSQL 16 temporário.
# Uso:  bash db-tests/run.sh        (precisa dos binários do PostgreSQL 16; não toca em nenhum banco real)
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
BASE="${MTA_PG_DIR:-/tmp/mta-pg}"
PORT="${MTA_PG_PORT:-54329}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB=mta_test

run_as() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
psqlx() { run_as "$PGBIN/psql" -h "$BASE/sock" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }

cleanup() { run_as "$PGBIN/pg_ctl" -D "$BASE/data" -m fast stop >/dev/null 2>&1 || true; }
trap cleanup EXIT

cleanup; rm -rf "$BASE"; mkdir -p "$BASE/sock"
[ "$(id -u)" = "0" ] && chown -R postgres:postgres "$BASE"
run_as "$PGBIN/initdb" -D "$BASE/data" -U postgres --locale=C.UTF-8 -E UTF8 >/dev/null
run_as "$PGBIN/pg_ctl" -D "$BASE/data" -l "$BASE/pg.log" -w \
  -o "-p $PORT -k $BASE/sock -c listen_addresses=''" start >/dev/null
psqlx -d postgres -c "create database $DB" >/dev/null

step() { echo "▶ $1"; shift; psqlx -d "$DB" -f - < "$1"; }

for m in "$ROOT"/db/migrations/*.sql; do step "Migração $(basename "$m")" "$m"; done
step "Usuários de teste (via convite) e auxiliares" "$ROOT/db-tests/01_users_and_helpers.sql"
step "Dados fictícios de demonstração"            "$ROOT/db/demo/demo_data.sql"
step "Testes de autorização"                      "$ROOT/db-tests/02_tests.sql"

echo; echo "================ RESULTADOS ================"
psqlx -d "$DB" -At -F ' | ' -c "select case when ok then 'PASSOU' else 'FALHOU' end, name || coalesce('   [' || detail || ']', '') from t.results order by id"
TOTAL=$(psqlx -d "$DB" -At -c "select count(*) from t.results")
FAILED=$(psqlx -d "$DB" -At -c "select count(*) from t.results where not ok")

# Persistência: nova conexão, dados ainda presentes (equivalente a "recarregar a página")
PERSIST=$(psqlx -d "$DB" -At -c "select (select count(*) from public.patients)||' pacientes, '||(select count(*) from public.sessions)||' sessões, '||(select count(*) from public.publications)||' publicações'")
echo "Persistência em nova conexão: $PERSIST"
echo "-------------------------------------------"
echo "Total: $TOTAL | Falhas: $FAILED"
[ "$FAILED" = "0" ]
