#!/usr/bin/env bash
set -euo pipefail

OUT="/tmp/xpay-golive-audit-$(date -u +%Y%m%dT%H%M%SZ).txt"

{
  echo "========================================"
  echo "XPAY GO-LIVE AUDIT"
  echo "========================================"
  date -u

  echo
  echo "=== GIT ==="
  git remote -v
  git branch --show-current
  git rev-parse HEAD
  git status --short
  git diff --stat

  echo
  echo "=== RUNTIME ==="
  node -v
  npm -v
  docker --version
  docker compose version

  echo
  echo "=== PACKAGE ==="
  cat package.json

  echo
  echo "=== PRISMA MODELS ==="
  grep -nE '^model ' prisma/schema.prisma

  echo
  echo "=== APP ROUTES ==="
  grep -RInE \
    "app\.use|app\.post|api\.use|router\.(get|post|put|patch|delete)" \
    src/core/app.ts \
    src/modules \
    | head -n 800

  echo
  echo "=== PAYMENTS ==="
  grep -RInE \
    "executePayment|paymentIntents|payment_method_types|routingRules|gatewayVault" \
    src/modules/payments \
    src/modules/checkout

  echo
  echo "=== STRIPE WEBHOOK ==="
  grep -RInE \
    "webhooks/stripe|constructEvent|express\.raw|Stripe-Signature|stripe-signature|webhookSecret" \
    src/core \
    src/modules/payments

  echo
  echo "=== WALLET / SETTLEMENT ==="
  grep -RInE \
    "processSettlements|walletMovement|available|reserved|pendente|disponivel|D\+3" \
    src/core \
    src/modules/wallet \
    src/modules/treasury \
    src/modules/payments

  echo
  echo "=== CHECKOUT DOMAINS ==="
  grep -RInE \
    "checkout\.xpayments|checkout\.xpay|api\.xpay|xpay\.expert" \
    src \
    .env.example \
    2>/dev/null || true

  echo
  echo "=== CATALOG ==="
  grep -RInE \
    "ProductStore|catalogScope|publicationStatus|product_stores|/catalog" \
    prisma \
    src/modules/catalog \
    src/modules/commerce \
    src/core/app.ts \
    2>/dev/null || true

  echo
  echo "=== BUILD ==="
  npm run build

} | tee "$OUT"

echo
echo "AUDIT_FILE=$OUT"
