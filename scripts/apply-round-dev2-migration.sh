#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/.." &&
  pwd
)"

cd "$PROJECT_DIR"

load_database_url() {
  if [ -n "${DATABASE_URL:-}" ]; then
    return
  fi

  DATABASE_URL="$(
    python3 <<'PY'
from pathlib import Path

env_path = Path(".env")

if not env_path.exists():
    raise SystemExit(".env não encontrado.")

for raw_line in env_path.read_text().splitlines():
    line = raw_line.strip()

    if not line.startswith("DATABASE_URL="):
        continue

    value = line.split("=", 1)[1].strip()

    if (
        len(value) >= 2
        and value[0] == value[-1]
        and value[0] in {'"', "'"}
    ):
        value = value[1:-1]

    print(value)
    break
PY
  )"

  export DATABASE_URL
}

build_migration_url() {
  if [ -n "${MIGRATION_DATABASE_URL:-}" ]; then
    return
  fi

  MIGRATION_DATABASE_URL="$(
    python3 <<'PY'
import os
from urllib.parse import (
    urlsplit,
    urlunsplit,
)

source = os.environ["DATABASE_URL"]
parts = urlsplit(source)

if not parts.hostname:
    raise SystemExit(
        "DATABASE_URL sem hostname."
    )

if "@" not in parts.netloc:
    raise SystemExit(
        "DATABASE_URL sem credenciais."
    )

raw_userinfo = parts.netloc.rsplit(
    "@",
    1
)[0]

netloc = (
    f"{raw_userinfo}@"
    f"{parts.hostname}:5432"
)

print(
    urlunsplit(
        (
            parts.scheme,
            netloc,
            parts.path,
            "sslmode=require",
            "",
        )
    )
)
PY
  )"

  export MIGRATION_DATABASE_URL
}

load_database_url

: "${DATABASE_URL:?DATABASE_URL is required}"

build_migration_url

: "${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL is required}"

command -v docker >/dev/null ||
  {
    echo "ERRO: Docker é obrigatório para pg_dump 17."
    exit 1
  }

command -v psql >/dev/null ||
  {
    echo "ERRO: psql é obrigatório."
    exit 1
  }

MIGRATION_FILE="
sql/20260722_round_dev2_foundation.sql
"

MIGRATION_FILE="$(
  echo "$MIGRATION_FILE" |
  xargs
)"

if [ ! -f "$MIGRATION_FILE" ]; then
  echo "ERRO: migração não encontrada: $MIGRATION_FILE"
  exit 1
fi

STAMP="$(
  date -u +%Y%m%dT%H%M%SZ
)"

BACKUP_DIR="$PROJECT_DIR/backups/database"
BACKUP_NAME="pre-round-dev2-${STAMP}.dump"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"
BACKUP_LIST_PATH="$BACKUP_DIR/pre-round-dev2-${STAMP}.list"
MIGRATION_LOG="$BACKUP_DIR/round-dev2-migration-${STAMP}.log"

mkdir -p "$BACKUP_DIR"

echo "=========================================="
echo "XPAY Round DEV-2 migration"
echo "=========================================="
echo "Backup: $BACKUP_PATH"
echo "Migration: $MIGRATION_FILE"
echo "=========================================="

echo
echo "[1/4] Validando conexão..."

psql \
  "$MIGRATION_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -Atc "
    SELECT
      current_database(),
      current_user,
      current_setting('server_version');
  "

echo
echo "[2/4] Criando backup PostgreSQL 17..."

docker run \
  --rm \
  --pull=missing \
  -e MIGRATION_DATABASE_URL="$MIGRATION_DATABASE_URL" \
  -e BACKUP_NAME="$BACKUP_NAME" \
  -v "$BACKUP_DIR:/backup" \
  postgres:17 \
  sh -Eeuc '
    pg_dump \
      --dbname="$MIGRATION_DATABASE_URL" \
      --format=custom \
      --no-owner \
      --no-privileges \
      --verbose \
      --file="/backup/$BACKUP_NAME"
  '

if [ ! -s "$BACKUP_PATH" ]; then
  echo "ERRO: o backup não foi criado."
  exit 1
fi

docker run \
  --rm \
  -e BACKUP_NAME="$BACKUP_NAME" \
  -v "$BACKUP_DIR:/backup:ro" \
  postgres:17 \
  sh -Eeuc '
    pg_restore \
      --list \
      "/backup/$BACKUP_NAME"
  ' > "$BACKUP_LIST_PATH"

if [ ! -s "$BACKUP_LIST_PATH" ]; then
  echo "ERRO: não foi possível validar o backup."
  exit 1
fi

echo "Backup validado:"
ls -lh "$BACKUP_PATH"

echo
echo "[3/4] Aplicando migração..."

set -o pipefail

psql \
  "$MIGRATION_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f "$MIGRATION_FILE" \
  2>&1 |
tee "$MIGRATION_LOG"

MIGRATION_EXIT="${PIPESTATUS[0]}"

if [ "$MIGRATION_EXIT" -ne 0 ]; then
  echo "ERRO: migração falhou com código $MIGRATION_EXIT."
  exit "$MIGRATION_EXIT"
fi

echo
echo "[4/4] Validando objetos DEV-2..."

psql \
  "$MIGRATION_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -P pager=off \
  -c "
    SELECT
      to_regclass(
        'public.security_challenges'
      ) AS security_challenges,
      to_regclass(
        'public.security_action_tokens'
      ) AS security_action_tokens,
      to_regclass(
        'public.notification_outbox'
      ) AS notification_outbox,
      to_regclass(
        'public.notification_preferences'
      ) AS notification_preferences,
      to_regclass(
        'public.api_idempotency_records'
      ) AS api_idempotency_records,
      to_regclass(
        'public.v_transactions_readable'
      ) AS transactions_view,
      to_regclass(
        'public.v_wallet_movements_readable'
      ) AS movements_view,
      to_regclass(
        'public.banking_accounts'
      ) AS banking_accounts,
      to_regclass(
        'public.banking_ledger_entries'
      ) AS banking_ledger_entries;
  "

echo
echo "=========================================="
echo "Round DEV-2 database migration applied."
echo "Backup: $BACKUP_PATH"
echo "Log: $MIGRATION_LOG"
echo "=========================================="
