#!/usr/bin/env bash
set -Eeuo pipefail

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

psql \
  --dbname="$DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --command="
    SELECT
      merchant_code,
      name,
      email
    FROM public.merchants
    ORDER BY created_at
    LIMIT 20;

    SELECT *
    FROM public.v_transactions_readable
    ORDER BY created_at DESC
    LIMIT 10;

    SELECT *
    FROM public.v_wallets_readable
    ORDER BY created_at DESC
    LIMIT 10;

    SELECT *
    FROM public.v_wallet_movements_readable
    ORDER BY created_at DESC
    LIMIT 20;

    SELECT
      status,
      channel,
      event_type,
      count(*)
    FROM public.notification_outbox
    GROUP BY status, channel, event_type
    ORDER BY status, channel, event_type;

    SELECT
      to_regclass('public.banking_accounts'),
      to_regclass('public.banking_ledger_transactions'),
      to_regclass('public.banking_ledger_entries');
  "
