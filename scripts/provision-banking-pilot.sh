#!/usr/bin/env bash
set -Eeuo pipefail

cd /root/xpay-expert-backend

if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL="$(
    python3 - <<'PY'
from pathlib import Path

for line in Path('.env').read_text().splitlines():
    if line.startswith('DATABASE_URL='):
        value = line.split('=', 1)[1].strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        print(value)
        break
PY
  )"
  export DATABASE_URL
fi

: "${DATABASE_URL:?DATABASE_URL is required}"

read -rp "Merchant email: " MERCHANT_EMAIL
read -rp "Currency [EUR]: " CURRENCY
CURRENCY="${CURRENCY:-EUR}"

psql \
  --dbname="$DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --set=merchant_email="$MERCHANT_EMAIL" \
  --set=currency="$CURRENCY" \
  <<'SQL'
SELECT
  id AS merchant_id,
  merchant_code
FROM public.merchants
WHERE email = :'merchant_email'
LIMIT 1
\gset

\if :{?merchant_id}
\else
  \echo 'MERCHANT_NOT_FOUND'
  \quit 1
\endif

INSERT INTO public.banking_customers (
  merchant_id,
  customer_code,
  status,
  provider
)
VALUES (
  :'merchant_id'::uuid,
  'BC-' || replace(:'merchant_id', '-', ''),
  'private_beta',
  'manual'
)
ON CONFLICT (merchant_id)
DO UPDATE SET updated_at = now();

SELECT id AS banking_customer_id
FROM public.banking_customers
WHERE merchant_id = :'merchant_id'::uuid
\gset

INSERT INTO public.banking_accounts (
  banking_customer_id,
  merchant_id,
  account_code,
  currency,
  account_type,
  status,
  provider,
  country
)
VALUES (
  :'banking_customer_id'::uuid,
  :'merchant_id'::uuid,
  'BA-' || upper(:'currency') || '-' || upper(substr(replace(:'merchant_id', '-', ''), 1, 10)),
  upper(:'currency'),
  'business',
  'active',
  'manual',
  'GB'
)
ON CONFLICT (account_code)
DO UPDATE SET updated_at = now();

SELECT id AS banking_account_id, account_code
FROM public.banking_accounts
WHERE account_code =
  'BA-' || upper(:'currency') || '-' || upper(substr(replace(:'merchant_id', '-', ''), 1, 10))
\gset

INSERT INTO public.banking_ledger_accounts (
  merchant_id,
  banking_account_id,
  code,
  name,
  currency,
  account_class
)
VALUES (
  :'merchant_id'::uuid,
  :'banking_account_id'::uuid,
  'LEDGER-' || :'account_code',
  'Customer Banking Account',
  upper(:'currency'),
  'liability'
)
ON CONFLICT (code) DO NOTHING;

SELECT
  :'merchant_code' AS merchant_code,
  :'account_code' AS account_code,
  upper(:'currency') AS currency,
  'active' AS status,
  'manual' AS provider_mode;
SQL
