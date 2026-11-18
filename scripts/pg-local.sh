#!/usr/bin/env bash
# PostgreSQL local descartável para desenvolvimento e testes (NÃO é para produção).
# Uso: bash scripts/pg-local.sh start|stop|reset
set -euo pipefail
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
BASE="${MTA_DEV_PG_DIR:-/tmp/mta-dev-pg}"
PORT="${MTA_DEV_PG_PORT:-54330}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${MTA_DEV_DB:-mta_dev}"
run_as() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
psqlx() { run_as "$PGBIN/psql" -h "$BASE/sock" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
stop() { run_as "$PGBIN/pg_ctl" -D "$BASE/data" -m fast stop >/dev/null 2>&1 || true; }
start() {
  if [ ! -d "$BASE/data" ]; then
    mkdir -p "$BASE/sock"; [ "$(id -u)" = "0" ] && chown -R postgres:postgres "$BASE"
    run_as "$PGBIN/initdb" -D "$BASE/data" -U postgres --locale=C.UTF-8 -E UTF8 >/dev/null
  fi
  run_as "$PGBIN/pg_ctl" -D "$BASE/data" -l "$BASE/pg.log" -w -o "-p $PORT -k $BASE/sock -c listen_addresses=''" start >/dev/null || true
  if ! psqlx -d postgres -At -c "select 1 from pg_database where datname='$DB'" | grep -q 1; then
    psqlx -d postgres -c "create database $DB" >/dev/null
    for m in "$ROOT"/db/migrations/*.sql; do psqlx -d "$DB" -f "$m" >/dev/null; done
    echo "banco $DB criado e migrado"
  fi
  echo "DATABASE_URL=postgres://postgres@localhost/$DB?host=$BASE/sock&port=$PORT"
}
case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  reset) stop; rm -rf "$BASE"; start ;;
esac
