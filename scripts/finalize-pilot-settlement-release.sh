#!/usr/bin/env bash

set -Eeuo pipefail

cd /root/xpay-expert-backend

XPAY_MASTER_ID="c8c0387b-ea92-4c31-a5bb-739e6d61d262"
API_LOCAL="http://127.0.0.1:3002"
API_PUBLIC="https://api.xpay.expert"

XPAY_MASTER_PASSWORD=""
XPAY_MASTER_TOKEN=""
LOGIN_PAYLOAD=""

cleanup() {
  unset \
    XPAY_MASTER_PASSWORD \
    XPAY_MASTER_TOKEN \
    LOGIN_PAYLOAD \
    LOCAL_LOGIN_RESPONSE \
    PUBLIC_LOGIN_RESPONSE
}

trap cleanup EXIT

fail() {
  echo
  echo "ERRO: $1"
  exit 1
}

echo
echo "============================================"
echo "1. VALIDAR TYPESCRIPT E GERAR PRISMA CLIENT"
echo "============================================"

npx prisma generate
npx tsc --noEmit --pretty false
npm run build

echo
echo "============================================"
echo "2. CONSTRUIR E PUBLICAR O CONTAINER"
echo "============================================"

docker compose build --no-cache
docker compose up -d

echo
echo "A aguardar health check..."

HEALTH_OK="false"

for attempt in $(seq 1 30); do
  if curl -fsS \
    "${API_PUBLIC}/api/health" \
    >/tmp/xpay-final-health.json 2>/dev/null
  then
    HEALTH_OK="true"
    break
  fi

  sleep 2
done

[ "$HEALTH_OK" = "true" ] || \
  fail "API não ficou saudável."

cat /tmp/xpay-final-health.json | jq

HEALTH_STATUS="$(
  jq -r '.status // ""' \
    /tmp/xpay-final-health.json
)"

[ "$HEALTH_STATUS" = "ONLINE" ] || \
  fail "API não retornou status ONLINE."

docker compose ps

echo
echo "============================================"
echo "3. VALIDAR CONFIGURAÇÃO FINANCEIRA"
echo "============================================"

RUNTIME_ENV="$(
  docker compose exec -T \
    xpay-expert-api \
    sh -lc '
      env |
      grep -E "^XPAY_(ADMIN_MERCHANT_IDS|LEGACY_SETTLEMENT_CRON_ENABLED|SETTLEMENT_LEDGER_AUTHORITATIVE|SETTLEMENT_RELEASE_MODE|PILOT_SETTLEMENT_OVERRIDE)=" |
      sort
    '
)"

printf '%s\n' "$RUNTIME_ENV"

printf '%s\n' "$RUNTIME_ENV" |
  grep -q \
    "XPAY_ADMIN_MERCHANT_IDS=.*${XPAY_MASTER_ID}" ||
  fail "XPay-Master não está configurado como Admin."

printf '%s\n' "$RUNTIME_ENV" |
  grep -q \
    '^XPAY_LEGACY_SETTLEMENT_CRON_ENABLED=false$' ||
  fail "Cron legado ainda está ativo."

printf '%s\n' "$RUNTIME_ENV" |
  grep -q \
    '^XPAY_SETTLEMENT_LEDGER_AUTHORITATIVE=true$' ||
  fail "Settlement Ledger não está autoritativo."

printf '%s\n' "$RUNTIME_ENV" |
  grep -q \
    '^XPAY_SETTLEMENT_RELEASE_MODE=manual$' ||
  fail "Release mode não está em manual."

printf '%s\n' "$RUNTIME_ENV" |
  grep -q \
    '^XPAY_PILOT_SETTLEMENT_OVERRIDE=true$' ||
  fail "Override piloto não está ativo."

echo
echo "============================================"
echo "4. AUTENTICAR XPAY-MASTER"
echo "============================================"

read -rsp \
  "Password atual do XPay-Master: " \
  XPAY_MASTER_PASSWORD

echo

LOGIN_PAYLOAD="$(
  jq -n \
    --arg email \
      "contact@xpay.expert" \
    --arg password \
      "$XPAY_MASTER_PASSWORD" \
    '{
      email: $email,
      password: $password
    }'
)"

LOCAL_LOGIN_RESPONSE="$(
  curl -sS \
    -X POST \
    "${API_LOCAL}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    --data-binary "$LOGIN_PAYLOAD"
)"

echo
echo "Login local:"

echo "$LOCAL_LOGIN_RESPONSE" |
  jq '{
    success,
    error,
    merchant:
      (
        .data.merchant //
        null
      )
  }'

LOCAL_SUCCESS="$(
  echo "$LOCAL_LOGIN_RESPONSE" |
  jq -r '.success // false'
)"

[ "$LOCAL_SUCCESS" = "true" ] || \
  fail "Login local falhou."

PUBLIC_LOGIN_RESPONSE="$(
  curl -sS \
    -X POST \
    "${API_PUBLIC}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    --data-binary "$LOGIN_PAYLOAD"
)"

echo
echo "Login público:"

echo "$PUBLIC_LOGIN_RESPONSE" |
  jq '{
    success,
    error,
    merchant:
      (
        .data.merchant //
        null
      )
  }'

PUBLIC_SUCCESS="$(
  echo "$PUBLIC_LOGIN_RESPONSE" |
  jq -r '.success // false'
)"

[ "$PUBLIC_SUCCESS" = "true" ] || \
  fail "Login público falhou."

AUTHENTICATED_MERCHANT_ID="$(
  echo "$PUBLIC_LOGIN_RESPONSE" |
  jq -r \
    '.data.merchant.id // ""'
)"

[ "$AUTHENTICATED_MERCHANT_ID" = "$XPAY_MASTER_ID" ] || \
  fail "O login retornou um Merchant inesperado."

XPAY_MASTER_TOKEN="$(
  echo "$PUBLIC_LOGIN_RESPONSE" |
  jq -er \
    '.data.token // .token'
)"

unset \
  XPAY_MASTER_PASSWORD \
  LOGIN_PAYLOAD

echo "OK: XPay-Master autenticado."

echo
echo "============================================"
echo "5. VALIDAR ACESSO ADMIN E LOCALIZAR BATCH"
echo "============================================"

ADMIN_RESPONSE="$(
  curl -sS \
    "${API_PUBLIC}/api/v1/admin/settlements?limit=100" \
    -H "Authorization: Bearer ${XPAY_MASTER_TOKEN}"
)"

echo "$ADMIN_RESPONSE" |
  jq

ADMIN_SUCCESS="$(
  echo "$ADMIN_RESPONSE" |
  jq -r '.success // false'
)"

[ "$ADMIN_SUCCESS" = "true" ] || \
  fail "Consulta Admin de Settlements falhou."

BATCH_ID="$(
  echo "$ADMIN_RESPONSE" |
  jq -er \
    --arg merchantId "$XPAY_MASTER_ID" '
      .data.items
      | map(
          select(
            .merchant_id == $merchantId
            and .status == "pending_provider"
          )
        )
      | sort_by(.business_date, .created_at)
      | reverse
      | .[0].id
    '
)"

[ -n "$BATCH_ID" ] || \
  fail "Nenhum Batch pending_provider encontrado."

echo
echo "Batch selecionado: $BATCH_ID"

BATCH_SUMMARY="$(
  echo "$ADMIN_RESPONSE" |
  jq \
    --arg batchId "$BATCH_ID" '
      .data.items[]
      | select(.id == $batchId)
      | {
          id,
          merchant_id,
          merchant_name,
          store_name,
          status,
          transaction_count,
          gross_amount,
          provider_fee,
          platform_fee,
          merchant_net,
          currency,
          provider_available_at
        }
    '
)"

echo "$BATCH_SUMMARY"

MERCHANT_NET="$(
  echo "$BATCH_SUMMARY" |
  jq -er '.merchant_net'
)"

echo
echo "Merchant Net a libertar: ${MERCHANT_NET}"

echo
echo "============================================"
echo "6. PILOT READY"
echo "============================================"

PILOT_READY_RESPONSE="$(
  curl -sS \
    -X POST \
    "${API_PUBLIC}/api/v1/admin/settlements/${BATCH_ID}/pilot-ready" \
    -H "Authorization: Bearer ${XPAY_MASTER_TOKEN}" \
    -H "Content-Type: application/json" \
    --data '{}'
)"

echo "$PILOT_READY_RESPONSE" |
  jq

PILOT_READY_SUCCESS="$(
  echo "$PILOT_READY_RESPONSE" |
  jq -r '.success // false'
)"

[ "$PILOT_READY_SUCCESS" = "true" ] || \
  fail "pilot-ready falhou."

PILOT_READY_STATUS="$(
  echo "$PILOT_READY_RESPONSE" |
  jq -r '.data.status // ""'
)"

[ "$PILOT_READY_STATUS" = "pending_review" ] || \
  fail "Batch não passou para pending_review."

echo
echo "============================================"
echo "7. RELEASE MANUAL"
echo "============================================"

RELEASE_RESPONSE="$(
  curl -sS \
    -X POST \
    "${API_PUBLIC}/api/v1/admin/settlements/${BATCH_ID}/release" \
    -H "Authorization: Bearer ${XPAY_MASTER_TOKEN}" \
    -H "Content-Type: application/json" \
    --data '{}'
)"

echo "$RELEASE_RESPONSE" |
  jq

RELEASE_SUCCESS="$(
  echo "$RELEASE_RESPONSE" |
  jq -r '.success // false'
)"

[ "$RELEASE_SUCCESS" = "true" ] || \
  fail "Release falhou."

RELEASE_STATUS="$(
  echo "$RELEASE_RESPONSE" |
  jq -r '.data.status // ""'
)"

[ "$RELEASE_STATUS" = "released" ] || \
  fail "Batch não ficou released."

RELEASED_AMOUNT="$(
  echo "$RELEASE_RESPONSE" |
  jq -r \
    '.data.releasedAmount // 0'
)"

echo
echo "Montante libertado: $RELEASED_AMOUNT"

echo
echo "============================================"
echo "8. PROVAR IDEMPOTÊNCIA DO RELEASE"
echo "============================================"

SECOND_RELEASE_RESPONSE="$(
  curl -sS \
    -X POST \
    "${API_PUBLIC}/api/v1/admin/settlements/${BATCH_ID}/release" \
    -H "Authorization: Bearer ${XPAY_MASTER_TOKEN}" \
    -H "Content-Type: application/json" \
    --data '{}'
)"

echo "$SECOND_RELEASE_RESPONSE" |
  jq

SECOND_RELEASE_SUCCESS="$(
  echo "$SECOND_RELEASE_RESPONSE" |
  jq -r '.success // false'
)"

SECOND_ALREADY_RELEASED="$(
  echo "$SECOND_RELEASE_RESPONSE" |
  jq -r \
    '.data.alreadyReleased // false'
)"

[ "$SECOND_RELEASE_SUCCESS" = "true" ] || \
  fail "Segundo Release retornou erro."

[ "$SECOND_ALREADY_RELEASED" = "true" ] || \
  fail "Idempotência do Release não foi comprovada."

echo
echo "============================================"
echo "9. INSPECIONAR LEDGER FINAL"
echo "============================================"

npx tsx \
  scripts/inspect-authoritative-ledger.ts \
  "$XPAY_MASTER_ID" \
  | tee /tmp/xpay-authoritative-ledger-final.json

FINAL_WALLET="$(
  jq -c \
    '.wallets[] | select(.currency == "EUR")' \
    /tmp/xpay-authoritative-ledger-final.json
)"

echo
echo "Wallet EUR final:"
echo "$FINAL_WALLET" | jq

FINAL_BALANCE="$(
  echo "$FINAL_WALLET" |
  jq -r '.balance'
)"

FINAL_AVAILABLE="$(
  echo "$FINAL_WALLET" |
  jq -r '.available'
)"

FINAL_RESERVED="$(
  echo "$FINAL_WALLET" |
  jq -r '.reserved'
)"

FINAL_PENDING="$(
  echo "$FINAL_WALLET" |
  jq -r '.pending'
)"

echo
echo "Balance:   $FINAL_BALANCE"
echo "Available: $FINAL_AVAILABLE"
echo "Reserved:  $FINAL_RESERVED"
echo "Pending:   $FINAL_PENDING"

python3 -c '
import sys

balance = float(sys.argv[1])
available = float(sys.argv[2])

if abs(balance - available) > 0.001:
    raise SystemExit(1)
' "$FINAL_BALANCE" "$FINAL_AVAILABLE" || \
  fail "Após o Release, available não coincide com balance."

python3 -c '
import sys

pending = float(sys.argv[1])

if abs(pending) > 0.001:
    raise SystemExit(1)
' "$FINAL_PENDING" || \
  fail "Após o Release, pending não é zero."

echo
echo "============================================"
echo "10. DESATIVAR OVERRIDE PILOTO"
echo "============================================"

python3 <<'PY'
from pathlib import Path

path = Path(".env")
text = path.read_text()

key = "XPAY_PILOT_SETTLEMENT_OVERRIDE"
value = "false"

lines = []
found = False

for line in text.splitlines():
    if line.startswith(f"{key}="):
        lines.append(f"{key}={value}")
        found = True
    else:
        lines.append(line)

if not found:
    lines.append(f"{key}={value}")

path.write_text(
    "\n".join(lines).rstrip() +
    "\n"
)
PY

docker compose up -d \
  --force-recreate

OVERRIDE_VALUE="$(
  docker compose exec -T \
    xpay-expert-api \
    sh -lc \
    'printf "%s" "$XPAY_PILOT_SETTLEMENT_OVERRIDE"'
)"

[ "$OVERRIDE_VALUE" = "false" ] || \
  fail "Override piloto não foi desativado no runtime."

echo
echo "============================================"
echo "SETTLEMENT PILOTO CONCLUÍDO"
echo "============================================"
echo
echo "Batch:      $BATCH_ID"
echo "Released:   $RELEASED_AMOUNT"
echo "Balance:    $FINAL_BALANCE"
echo "Available:  $FINAL_AVAILABLE"
echo "Reserved:   $FINAL_RESERVED"
echo "Pending:    $FINAL_PENDING"
echo "Override:   false"
echo
