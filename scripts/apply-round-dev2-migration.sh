#!/usr/bin/env bash
set -Eeuo pipefail

cd /root/xpay-expert-backend

if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL="$(
    python3 - <<'PY'
from pathlib import Path

for line in Path(".env").read_text().splitlines():
    if line.startswith("DATABASE_URL="):
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
fi

: "${DATABASE_URL:?DATABASE_URL is required}"

if [ -z "${MIGRATION_DATABASE_URL:-}" ]; then
  MIGRATION_DATABASE_URL="$(
    python3 <<'PYURL'
import os
from urllib.parse import (
    parse_qsl,
    urlencode,
    urlsplit,
    urlunsplit,
)

parts = urlsplit(
    os.environ["DATABASE_URL"]
)

if not parts.hostname:
    raise SystemExit(
        "DATABASE_URL sem hostname."
    )

userinfo = ""

if parts.username is not None:
    userinfo = parts.username

    if parts.password is not None:
        userinfo += f":{parts.password}"

    userinfo += "@"

netloc = (
    f"{userinfo}"
    f"{parts.hostname}:5432"
)

unsupported = {
    "pgbouncer",
    "connection_limit",
    "pool_timeout",
    "connect_timeout_ms",
}

query = [
    (key, value)
    for key, value in parse_qsl(
        parts.query,
        keep_blank_values=True,
    )
    if key not in unsupported
]

print(
    urlunsplit(
        (
            parts.scheme,
            netloc,
            parts.path,
            urlencode(query),
            parts.fragment,
        )
    )
)
PYURL
  )"
fi

export MIGRATION_DATABASE_URL

if [ -z "${MIGRATION_DATABASE_URL:-}" ]; then
  MIGRATION_DATABASE_URL="$(
    python3 <<'PYURL'
import os
from urllib.parse import (
    parse_qsl,
    urlencode,
    urlsplit,
    urlunsplit,
)

parts = urlsplit(
    os.environ["DATABASE_URL"]
)

if not parts.hostname:
    raise SystemExit(
        "DATABASE_URL sem hostname."
    )

userinfo = ""

if parts.username is not None:
    userinfo = parts.username

    if parts.password is not None:
        userinfo += f":{parts.password}"

    userinfo += "@"

netloc = (
    f"{userinfo}"
    f"{parts.hostname}:5432"
)

unsupported = {
    "pgbouncer",
    "connection_limit",
    "pool_timeout",
    "connect_timeout_ms",
}

query = [
    (key, value)
    for key, value in parse_qsl(
        parts.query,
        keep_blank_values=True,
    )
    if key not in unsupported
]

print(
    urlunsplit(
        (
            parts.scheme,
            netloc,
            parts.path,
            urlencode(query),
            parts.fragment,
        )
    )
)
PYURL
  )"
fi

export MIGRATION_DATABASE_URL

command -v pg_dump >/dev/null ||
  { echo "pg_dump is required."; exit 1; }

command -v psql >/dev/null ||
  { echo "psql is required."; exit 1; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p backups/database

pg_dump \
  --dbname="$MIGRATION_DATABASE_URL" \
  --format=custom \
  --file="backups/database/pre-round-dev2-${STAMP}.dump"

psql \
  --dbname="$MIGRATION_DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --file=sql/20260722_round_dev2_foundation.sql

psql \
  --dbname="$MIGRATION_DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --command="
    SELECT
      to_regclass('public.security_challenges') AS security_challenges,
      to_regclass('public.notification_outbox') AS notification_outbox,
      to_regclass('public.v_transactions_readable') AS transactions_view,
      to_regclass('public.v_wallet_movements_readable') AS movements_view,
      to_regclass('public.banking_accounts') AS banking_accounts,
      to_regclass('public.banking_ledger_entries') AS banking_ledger_entries;
  "

echo "Round DEV-2 database migration applied."
