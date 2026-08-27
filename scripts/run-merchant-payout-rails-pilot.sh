#!/usr/bin/env bash

set -Eeuo pipefail

cd /root/xpay-expert-backend

API="https://api.xpay.expert"
EMAIL="contact@xpay.expert"

PASSWORD=""
TOKEN=""

cleanup() {
  unset \
    PASSWORD \
    TOKEN \
    LOGIN_PAYLOAD
}

trap cleanup EXIT

fail() {
  echo
  echo "ERRO: $1"
  exit 1
}

api_post() {
  local path="$1"
  local payload="$2"

  curl -sS \
    -X POST \
    "${API}${path}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    --data-binary "$payload"
}

validate_payload() {
  local label="$1"
  local payload="$2"

  echo
  echo "--------------------------------------------"
  echo "VALIDAR: $label"
  echo "--------------------------------------------"

  local response

  response="$(
    api_post \
      "/api/v1/merchant/payouts/validate" \
      "$payload"
  )"

  echo "$response" |
    jq '{
      success,
      error,
      validation:
        (
          .data.validation
          | {
              valid,
              executionMode,
              fxMode,
              wallet,
              request
            }
        )
    }'

  echo "$response" |
    jq -e \
      '.success == true and .data.validation.valid == true' \
    >/dev/null ||
    fail "Validação falhou: $label."
}

expect_validation_error() {
  local label="$1"
  local expected_code="$2"
  local payload="$3"

  echo
  echo "--------------------------------------------"
  echo "ERRO ESPERADO: $label"
  echo "--------------------------------------------"

  local response

  response="$(
    api_post \
      "/api/v1/merchant/payouts/validate" \
      "$payload"
  )"

  echo "$response" | jq

  local code

  code="$(
    echo "$response" |
    jq -r '.error.code // ""'
  )"

  [ "$code" = "$expected_code" ] || \
    fail \
      "Esperado $expected_code, recebido $code."

  echo "OK: $expected_code rejeitado corretamente."
}

create_and_cancel() {
  local label="$1"
  local payload="$2"

  local idempotency_key

  idempotency_key="$(
    printf \
      'rail-pilot-%s-%s-%s' \
      "$(echo "$label" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')" \
      "$(date -u +%Y%m%dT%H%M%S)" \
      "$RANDOM"
  )"

  echo
  echo "============================================"
  echo "CRIAR E CANCELAR: $label"
  echo "============================================"

  local response

  response="$(
    curl -sS \
      -X POST \
      "${API}/api/v1/merchant/payouts" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H "Content-Type: application/json" \
      -H "Idempotency-Key: ${idempotency_key}" \
      --data-binary "$payload"
  )"

  echo "$response" |
    jq '{
      success,
      error,
      payout:
        (
          .data.payout
          | {
              id,
              ticketCode,
              sourceCurrency,
              sourceAmount,
              payoutCurrency,
              payoutAmount,
              method,
              network,
              status,
              fxRequired,
              fxStatus,
              destination
            }
        )
    }'

  echo "$response" |
    jq -e '.success == true' \
    >/dev/null ||
    fail "Criação falhou: $label."

  local payout_id

  payout_id="$(
    echo "$response" |
    jq -er '.data.payout.id'
  )"

  local cancel_response

  cancel_response="$(
    api_post \
      "/api/v1/merchant/payouts/${payout_id}/cancel" \
      '{
        "reason":
          "Piloto de validação do rail concluído. Nenhum pagamento externo executado."
      }'
  )"

  echo "$cancel_response" |
    jq '{
      success,
      error,
      payout:
        (
          .data.payout
          | {
              id,
              ticketCode,
              method,
              status,
              fxStatus
            }
        ),
      alreadyApplied:
        .data.alreadyApplied
    }'

  local cancel_status

  cancel_status="$(
    echo "$cancel_response" |
    jq -r '.data.payout.status // ""'
  )"

  [ "$cancel_status" = "cancelled" ] || \
    fail "Cancelamento falhou: $label."

  echo "OK: $label criado e cancelado."
}

echo
echo "============================================"
echo "1. AUTENTICAR"
echo "============================================"

read -rsp \
  "Password atual do XPay-Master: " \
  PASSWORD
echo

LOGIN_PAYLOAD="$(
  jq -n \
    --arg email "$EMAIL" \
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
  fail "Login falhou."

TOKEN="$(
  echo "$LOGIN_RESPONSE" |
  jq -er '.data.token // .token'
)"

unset \
  PASSWORD \
  LOGIN_PAYLOAD

echo
echo "============================================"
echo "2. OBTER OPÇÕES"
echo "============================================"

curl -sS \
  "${API}/api/v1/merchant/payouts/options" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq

echo
echo "============================================"
echo "3. CAPTURAR WALLET INICIAL"
echo "============================================"

npx tsx \
  scripts/inspect-authoritative-ledger.ts \
  > /tmp/xpay-rails-before.json

WALLET_ID="$(
  jq -er '
    .wallets[]
    | select(.currency == "EUR")
    | .id
  ' /tmp/xpay-rails-before.json
)"

BEFORE_WALLET="$(
  jq -c '
    .wallets[]
    | select(.currency == "EUR")
  ' /tmp/xpay-rails-before.json
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

SEPA_PAYLOAD="$(
  jq -n \
    --arg walletId "$WALLET_ID" \
    '{
      walletId: $walletId,
      amount: 0.25,
      payoutCurrency: "EUR",
      method: "SEPA_INSTANT",
      beneficiaryName:
        "XPAY SEPA Pilot",
      beneficiaryCountry:
        "DE",
      destination: {
        beneficiaryName:
          "XPAY SEPA Pilot",
        iban:
          "DE89 3704 0044 0532 0130 00",
        bic:
          "COBADEFFXXX",
        bankName:
          "XPAY Pilot Bank",
        country:
          "DE",
        paymentReference:
          "DO NOT EXECUTE"
      }
    }'
)"

PIX_EVP_PAYLOAD="$(
  jq -n \
    --arg walletId "$WALLET_ID" \
    '{
      walletId: $walletId,
      amount: 0.25,
      payoutCurrency: "BRL",
      method: "PIX",
      beneficiaryName:
        "XPAY PIX Pilot",
      beneficiaryCountry:
        "BR",
      destination: {
        beneficiaryName:
          "XPAY PIX Pilot",
        keyType:
          "EVP",
        keyValue:
          "123e4567-e89b-12d3-a456-426614174000",
        country:
          "BR"
      }
    }'
)"

TRC20_PAYLOAD="$(
  jq -n \
    --arg walletId "$WALLET_ID" \
    '{
      walletId: $walletId,
      amount: 0.25,
      payoutCurrency: "USDT",
      method: "USDT_TRC20",
      beneficiaryName:
        "XPAY TRC20 Pilot",
      destination: {
        beneficiaryName:
          "XPAY TRC20 Pilot",
        walletAddress:
          "T111111111111111111111111111111111"
      }
    }'
)"

ERC20_PAYLOAD="$(
  jq -n \
    --arg walletId "$WALLET_ID" \
    '{
      walletId: $walletId,
      amount: 0.25,
      payoutCurrency: "USDT",
      method: "USDT_ERC20",
      beneficiaryName:
        "XPAY ERC20 Pilot",
      destination: {
        beneficiaryName:
          "XPAY ERC20 Pilot",
        walletAddress:
          "0x1111111111111111111111111111111111111111"
      }
    }'
)"

MANUAL_GBP_PAYLOAD="$(
  jq -n \
    --arg walletId "$WALLET_ID" \
    '{
      walletId: $walletId,
      amount: 0.25,
      payoutCurrency: "GBP",
      method: "MANUAL",
      beneficiaryName:
        "XPAY GBP Pilot",
      beneficiaryCountry:
        "GB",
      destination: {
        beneficiaryName:
          "XPAY GBP Pilot",
        country:
          "GB",
        network:
          "MANUAL_BANK_TRANSFER",
        instructions:
          "Manual GBP payout validation only. Do not execute."
      }
    }'
)"

echo
echo "============================================"
echo "4. VALIDAR RAILS PRINCIPAIS"
echo "============================================"

validate_payload \
  "SEPA Instant" \
  "$SEPA_PAYLOAD"

validate_payload \
  "PIX EVP" \
  "$PIX_EVP_PAYLOAD"

validate_payload \
  "USDT TRC20" \
  "$TRC20_PAYLOAD"

validate_payload \
  "USDT ERC20" \
  "$ERC20_PAYLOAD"

validate_payload \
  "Manual GBP cross-currency" \
  "$MANUAL_GBP_PAYLOAD"

echo
echo "============================================"
echo "5. VALIDAR TODOS OS TIPOS PIX"
echo "============================================"

for pix_data in \
  'CPF|52998224725' \
  'CNPJ|11222333000181' \
  'EMAIL|qa+payout@example.com' \
  'PHONE|+5511999999999' \
  'EVP|123e4567-e89b-12d3-a456-426614174000'
do
  PIX_TYPE="${pix_data%%|*}"
  PIX_VALUE="${pix_data#*|}"

  PIX_PAYLOAD="$(
    jq -n \
      --arg walletId "$WALLET_ID" \
      --arg keyType "$PIX_TYPE" \
      --arg keyValue "$PIX_VALUE" \
      '{
        walletId: $walletId,
        amount: 0.25,
        payoutCurrency: "BRL",
        method: "PIX",
        destination: {
          beneficiaryName:
            "XPAY PIX Validation",
          keyType: $keyType,
          keyValue: $keyValue,
          country: "BR"
        }
      }'
  )"

  validate_payload \
    "PIX ${PIX_TYPE}" \
    "$PIX_PAYLOAD"
done

echo
echo "============================================"
echo "6. COMPROVAR REJEIÇÃO DE DADOS INVÁLIDOS"
echo "============================================"

INVALID_IBAN_PAYLOAD="$(
  jq -n \
    --arg walletId "$WALLET_ID" \
    '{
      walletId: $walletId,
      amount: 0.25,
      payoutCurrency: "EUR",
      method: "SEPA_INSTANT",
      destination: {
        beneficiaryName:
          "Invalid IBAN",
        iban:
          "PT000000000000",
        country:
          "PT"
      }
    }'
)"

expect_validation_error \
  "IBAN inválido" \
  "INVALID_IBAN" \
  "$INVALID_IBAN_PAYLOAD"

INVALID_CPF_PAYLOAD="$(
  jq -n \
    --arg walletId "$WALLET_ID" \
    '{
      walletId: $walletId,
      amount: 0.25,
      payoutCurrency: "BRL",
      method: "PIX",
      destination: {
        beneficiaryName:
          "Invalid CPF",
        keyType:
          "CPF",
        keyValue:
          "11111111111",
        country:
          "BR"
      }
    }'
)"

expect_validation_error \
  "CPF inválido" \
  "INVALID_PIX_CPF" \
  "$INVALID_CPF_PAYLOAD"

INVALID_ERC20_PAYLOAD="$(
  jq -n \
    --arg walletId "$WALLET_ID" \
    '{
      walletId: $walletId,
      amount: 0.25,
      payoutCurrency: "USDT",
      method: "USDT_ERC20",
      destination: {
        beneficiaryName:
          "Invalid ERC20",
        walletAddress:
          "0x123"
      }
    }'
)"

expect_validation_error \
  "ERC20 inválido" \
  "INVALID_ERC20_ADDRESS" \
  "$INVALID_ERC20_PAYLOAD"

echo
echo "============================================"
echo "7. CRIAR E CANCELAR TICKETS REAIS"
echo "============================================"

create_and_cancel \
  "SEPA-INSTANT" \
  "$SEPA_PAYLOAD"

create_and_cancel \
  "PIX-EVP" \
  "$PIX_EVP_PAYLOAD"

create_and_cancel \
  "USDT-TRC20" \
  "$TRC20_PAYLOAD"

create_and_cancel \
  "USDT-ERC20" \
  "$ERC20_PAYLOAD"

echo
echo "============================================"
echo "8. VALIDAR WALLET FINAL"
echo "============================================"

npx tsx \
  scripts/inspect-authoritative-ledger.ts \
  > /tmp/xpay-rails-after.json

AFTER_WALLET="$(
  jq -c '
    .wallets[]
    | select(.currency == "EUR")
  ' /tmp/xpay-rails-after.json
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

for left, right in zip(
    before,
    after
):
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
echo "PILOTO DOS RAILS CONCLUÍDO"
echo "============================================"
echo
echo "SEPA Instant:      validado"
echo "PIX CPF:           validado"
echo "PIX CNPJ:          validado"
echo "PIX Email:         validado"
echo "PIX Phone:         validado"
echo "PIX EVP:           validado"
echo "USDT TRC20:        validado"
echo "USDT ERC20:        validado"
echo "Manual GBP/FX:     validado"
echo
echo "Balance:           $AFTER_BALANCE"
echo "Available:         $AFTER_AVAILABLE"
echo "Reserved:          $AFTER_RESERVED"
echo
echo "Nenhuma transferência externa foi executada."
echo
