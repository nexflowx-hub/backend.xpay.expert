#!/usr/bin/env bash

set -Eeuo pipefail

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
  jq -e \
    '.success == true' \
  >/dev/null ||
  fail "Login falhou."

TOKEN="$(
  echo "$LOGIN_RESPONSE" |
  jq -er \
    '.data.token // .token'
)"

unset \
  PASSWORD \
  LOGIN_PAYLOAD

RESPONSE="$(
  curl -sS \
    "${API}/api/v1/platform/capabilities" \
    -H "Authorization: Bearer ${TOKEN}"
)"

echo
echo "============================================"
echo "PLATFORM CAPABILITIES"
echo "============================================"

echo "$RESPONSE" | jq

echo "$RESPONSE" |
  jq -e '
    .success == true
    and
    .data.identity.isPlatformAdmin == true
    and
    .data.capabilities.commerce == true
    and
    .data.capabilities.merchantPayouts == true
    and
    .data.capabilities.settlements == true
    and
    .data.capabilities.adminConsole == true
    and
    .data.capabilities.banking == false
    and
    .data.capabilities.advisory == true
    and
    .data.operations.payoutExecution == "manual"
    and
    .data.operations.payoutFx == "manual"
    and
    .data.operations.settlementRelease == "manual"
  ' \
  >/dev/null ||
  fail "Contrato Platform Capabilities inesperado."

echo
echo "Platform Capabilities validado."
