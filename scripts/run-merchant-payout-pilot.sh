#!/usr/bin/env bash

set -Eeuo pipefail

cd /root/xpay-expert-backend

API="https://api.xpay.expert"
MERCHANT_EMAIL="contact@xpay.expert"

PASSWORD=""
TOKEN=""
PAYOUT_PAYLOAD=""

cleanup() {
  unset \
    PASSWORD \
    TOKEN \
    LOGIN_PAYLOAD \
    PAYOUT_PAYLOAD
}

trap cleanup EXIT

fail() {
  echo
  echo "ERRO: $1"
  exit 1
}

echo
echo "============================================"
echo "1. VALIDAR FLAGS DO RUNTIME"
echo "============================================"

LEGACY_CRON="$(
  docker compose exec -T \
    xpay-expert-api \
    sh -lc \
    'printf "%s" "$XPAY_LEGACY_SETTLEMENT_CRON_ENABLED"'
)"

PAYOUTS_ENABLED="$(
  docker compose exec -T \
    xpay-expert-api \
    sh -lc \
    'printf "%s" "$XPAY_PAYOUTS_ENABLED"'
)"

AUTO_EXECUTION="$(
  docker compose exec -T \
    xpay-expert-api \
    sh -lc \
    'printf "%s" "$XPAY_PAYOUT_EXECUTION_AUTOMATIC_ENABLED"'
)"

AUTO_FX="$(
  docker compose exec -T \
    xpay-expert-api \
    sh -lc \
    'printf "%s" "$XPAY_PAYOUT_FX_AUTOMATIC_ENABLED"'
)"

echo "Legacy settlement cron: $LEGACY_CRON"
echo "Merchant Payouts:       $PAYOUTS_ENABLED"
echo "Automatic execution:    $AUTO_EXECUTION"
echo "Automatic FX:           $AUTO_FX"

[ "$LEGACY_CRON" = "false" ] || \
  fail "Legacy Settlement CRON não está desativado."

[ "$PAYOUTS_ENABLED" = "true" ] || \
  fail "Merchant Payouts não estão ativos."

[ "$AUTO_EXECUTION" = "false" ] || \
  fail "Execução automática de Payout está ativa."

[ "$AUTO_FX" = "false" ] || \
  fail "Câmbio automático está ativo."

echo
echo "============================================"
echo "2. AUTENTICAR XPAY-MASTER"
echo "============================================"

read -rsp \
  "Password atual do XPay-Master: " \
  PASSWORD
echo

LOGIN_PAYLOAD="$(
  jq -n \
    --arg email "$MERCHANT_EMAIL" \
    --arg password "$PASSWORD" \
    '{
      email: $email,
      password: $password
    }'
)"

LOGIN_RESPONSE="$(
  curl -sS \
    -X POST \
    "${API}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    --data-binary "$LOGIN_PAYLOAD"
)"

echo "$LOGIN_RESPONSE" |
  jq '{
    success,
    error,
    merchant:
      (.data.merchant // null)
  }'

echo "$LOGIN_RESPONSE" |
  jq -e '.success == true' \
  >/dev/null ||
  fail "Login do XPay-Master falhou."

TOKEN="$(
  echo "$LOGIN_RESPONSE" |
  jq -er '.data.token // .token'
)"

unset \
  PASSWORD \
  LOGIN_PAYLOAD

echo
echo "============================================"
echo "3. REGISTAR WALLET ANTES DO PILOTO"
echo "============================================"

npx tsx \
  scripts/inspect-authoritative-ledger.ts \
  > /tmp/xpay-payout-pilot-before.json

WALLET_ID="$(
  jq -er '
    .wallets[]
    | select(.currency == "EUR")
    | .id
  ' /tmp/xpay-payout-pilot-before.json
)"

BEFORE_WALLET="$(
  jq -c '
    .wallets[]
    | select(.currency == "EUR")
  ' /tmp/xpay-payout-pilot-before.json
)"

echo "$BEFORE_WALLET" | jq

BEFORE_BALANCE="$(
  echo "$BEFORE_WALLET" |
  jq -r '.balance'
)"

BEFORE_AVAILABLE="$(
  echo "$BEFORE_WALLET" |
  jq -r '.available'
)"

BEFORE_RESERVED="$(
  echo "$BEFORE_WALLET" |
  jq -r '.reserved'
)"

python3 -c '
import sys

available = float(sys.argv[1])

if available < 1:
    raise SystemExit(1)
' "$BEFORE_AVAILABLE" ||
  fail "Saldo disponível inferior a €1,00."

echo
echo "============================================"
echo "4. CRIAR MERCHANT PAYOUT DE €1,00"
echo "============================================"

IDEMPOTENCY_KEY="$(
  printf \
    'merchant-payout-pilot-%s' \
    "$(date -u +%Y%m%dT%H%M%SZ)"
)"

PAYOUT_PAYLOAD="$(
  jq -n \
    --arg walletId "$WALLET_ID" \
    '{
      walletId: $walletId,
      amount: 1,
      payoutCurrency: "EUR",
      method: "MANUAL",
      beneficiaryName:
        "XPAY Internal Pilot",
      beneficiaryCountry:
        "PT",
      destination: {
        beneficiaryName:
          "XPAY Internal Pilot",
        country:
          "PT",
        instructions:
          "INTERNAL PILOT — DO NOT EXECUTE PAYMENT"
      }
    }'
)"

CREATE_RESPONSE="$(
  curl -sS \
    -X POST \
    "${API}/api/v1/merchant/payouts" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: ${IDEMPOTENCY_KEY}" \
    --data-binary "$PAYOUT_PAYLOAD"
)"

echo "$CREATE_RESPONSE" | jq

echo "$CREATE_RESPONSE" |
  jq -e '.success == true' \
  >/dev/null ||
  fail "Criação do Merchant Payout falhou."

PAYOUT_ID="$(
  echo "$CREATE_RESPONSE" |
  jq -er '.data.payout.id'
)"

CREATE_STATUS="$(
  echo "$CREATE_RESPONSE" |
  jq -r '.data.payout.status'
)"

[ "$CREATE_STATUS" = "pending_review" ] || \
  fail "Estado inicial inesperado: $CREATE_STATUS."

echo
echo "Payout ID: $PAYOUT_ID"

echo
echo "============================================"
echo "5. PROVAR IDEMPOTÊNCIA DA CRIAÇÃO"
echo "============================================"

REPLAY_RESPONSE="$(
  curl -sS \
    -X POST \
    "${API}/api/v1/merchant/payouts" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: ${IDEMPOTENCY_KEY}" \
    --data-binary "$PAYOUT_PAYLOAD"
)"

echo "$REPLAY_RESPONSE" | jq

REPLAY_ID="$(
  echo "$REPLAY_RESPONSE" |
  jq -er '.data.payout.id'
)"

REPLAY_FLAG="$(
  echo "$REPLAY_RESPONSE" |
  jq -r '.data.idempotentReplay'
)"

[ "$REPLAY_ID" = "$PAYOUT_ID" ] || \
  fail "O replay criou outro Payout."

[ "$REPLAY_FLAG" = "true" ] || \
  fail "Replay não foi identificado como idempotente."

echo "OK: criação idempotente."

echo
echo "============================================"
echo "6. VALIDAR RESERVA DA WALLET"
echo "============================================"

npx tsx \
  scripts/inspect-authoritative-ledger.ts \
  > /tmp/xpay-payout-pilot-reserved.json

RESERVED_WALLET="$(
  jq -c '
    .wallets[]
    | select(.currency == "EUR")
  ' /tmp/xpay-payout-pilot-reserved.json
)"

echo "$RESERVED_WALLET" | jq

RESERVED_BALANCE="$(
  echo "$RESERVED_WALLET" |
  jq -r '.balance'
)"

RESERVED_AVAILABLE="$(
  echo "$RESERVED_WALLET" |
  jq -r '.available'
)"

RESERVED_AMOUNT="$(
  echo "$RESERVED_WALLET" |
  jq -r '.reserved'
)"

python3 -c '
import sys

before_balance = float(sys.argv[1])
before_available = float(sys.argv[2])
before_reserved = float(sys.argv[3])

balance = float(sys.argv[4])
available = float(sys.argv[5])
reserved = float(sys.argv[6])

assert abs(balance - before_balance) < 0.001
assert abs(available - (before_available - 1)) < 0.001
assert abs(reserved - (before_reserved + 1)) < 0.001
' \
  "$BEFORE_BALANCE" \
  "$BEFORE_AVAILABLE" \
  "$BEFORE_RESERVED" \
  "$RESERVED_BALANCE" \
  "$RESERVED_AVAILABLE" \
  "$RESERVED_AMOUNT" ||
  fail "Reserva financeira da Wallet está incorreta."

echo "OK: €1,00 movido de available para reserved."

echo
echo "============================================"
echo "7. APROVAR O TICKET"
echo "============================================"

APPROVE_RESPONSE="$(
  curl -sS \
    -X POST \
    "${API}/api/v1/admin/merchant-payouts/${PAYOUT_ID}/approve" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    --data '{
      "note":
        "Piloto técnico do Merchant Payout Engine."
    }'
)"

echo "$APPROVE_RESPONSE" | jq

APPROVE_STATUS="$(
  echo "$APPROVE_RESPONSE" |
  jq -r '.data.payout.status // ""'
)"

[ "$APPROVE_STATUS" = "approved" ] || \
  fail "Aprovação falhou."

echo
echo "============================================"
echo "8. REJEITAR E RESTAURAR O SALDO"
echo "============================================"

REJECT_RESPONSE="$(
  curl -sS \
    -X POST \
    "${API}/api/v1/admin/merchant-payouts/${PAYOUT_ID}/reject" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    --data '{
      "reason":
        "Piloto técnico concluído. Nenhuma transferência externa executada."
    }'
)"

echo "$REJECT_RESPONSE" | jq

REJECT_STATUS="$(
  echo "$REJECT_RESPONSE" |
  jq -r '.data.payout.status // ""'
)"

[ "$REJECT_STATUS" = "rejected" ] || \
  fail "Rejeição falhou."

echo
echo "============================================"
echo "9. VALIDAR RESTAURAÇÃO DA WALLET"
echo "============================================"

npx tsx \
  scripts/inspect-authoritative-ledger.ts \
  > /tmp/xpay-payout-pilot-after.json

AFTER_WALLET="$(
  jq -c '
    .wallets[]
    | select(.currency == "EUR")
  ' /tmp/xpay-payout-pilot-after.json
)"

echo "$AFTER_WALLET" | jq

AFTER_BALANCE="$(
  echo "$AFTER_WALLET" |
  jq -r '.balance'
)"

AFTER_AVAILABLE="$(
  echo "$AFTER_WALLET" |
  jq -r '.available'
)"

AFTER_RESERVED="$(
  echo "$AFTER_WALLET" |
  jq -r '.reserved'
)"

python3 -c '
import sys

before = [
    float(sys.argv[1]),
    float(sys.argv[2]),
    float(sys.argv[3])
]

after = [
    float(sys.argv[4]),
    float(sys.argv[5]),
    float(sys.argv[6])
]

for left, right in zip(before, after):
    if abs(left - right) > 0.001:
        raise SystemExit(1)
' \
  "$BEFORE_BALANCE" \
  "$BEFORE_AVAILABLE" \
  "$BEFORE_RESERVED" \
  "$AFTER_BALANCE" \
  "$AFTER_AVAILABLE" \
  "$AFTER_RESERVED" ||
  fail "A Wallet não regressou ao estado inicial."

echo
echo "============================================"
echo "10. CONSULTAR O TICKET FINAL"
echo "============================================"

curl -sS \
  "${API}/api/v1/admin/merchant-payouts/${PAYOUT_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq

echo
echo "============================================"
echo "PILOTO MERCHANT PAYOUT CONCLUÍDO"
echo "============================================"
echo
echo "Payout ID:  $PAYOUT_ID"
echo "Estado:     rejected"
echo "Balance:    $AFTER_BALANCE"
echo "Available:  $AFTER_AVAILABLE"
echo "Reserved:   $AFTER_RESERVED"
echo
echo "Nenhuma transferência externa foi executada."
echo
