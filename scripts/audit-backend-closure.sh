#!/usr/bin/env bash

set -Eeuo pipefail

cd /root/xpay-expert-backend

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="/tmp/xpay-backend-closure-${STAMP}.txt"

section() {
  echo
  echo "=================================================="
  echo "$1"
  echo "=================================================="
}

exec > >(tee "$OUT") 2>&1
  section "XPAY BACKEND CLOSURE AUDIT"

  echo "Timestamp: $(date -u +%FT%TZ)"
  echo "Directory: $(pwd)"

  section "GIT"

  echo "Branch:"
  git branch --show-current || true

  echo
  echo "Commit:"
  git rev-parse HEAD || true

  echo
  echo "Working tree:"
  git status --short || true

  section "RUNTIME"

  node --version
  npm --version
  npx prisma --version || true

  section "DOCKER"

  docker compose ps

  docker inspect \
    xpay-expert-api \
    --format 'Status={{.State.Status}} Running={{.State.Running}} Restarting={{.State.Restarting}} ExitCode={{.State.ExitCode}} StartedAt={{.State.StartedAt}}' \
    || true

  section "PUBLIC HEALTH"

  curl -fsS \
    https://api.xpay.expert/api/health \
    | jq

  section "SAFE RUNTIME FLAGS"

  docker compose exec -T \
    xpay-expert-api \
    sh -lc '
      env |
      grep -E "^XPAY_(PAYOUTS_ENABLED|PAYOUT_EXECUTION_AUTOMATIC_ENABLED|PAYOUT_FX_AUTOMATIC_ENABLED|SETTLEMENT_RELEASE_MODE|LEGACY_SETTLEMENT_CRON_ENABLED|SETTLEMENT_LEDGER_AUTHORITATIVE|PILOT_SETTLEMENT_OVERRIDE|NOTIFICATIONS_TELEGRAM_ENABLED|NOTIFICATIONS_DISCORD_ENABLED|NOTIFICATIONS_EMAIL_ENABLED|NOTIFICATIONS_WHATSAPP_ENABLED)=" |
      sort
    ' || true
  section "MODULE TREE"

  find src/modules \
    -maxdepth 4 \
    -type f \
    -name '*.ts' \
    ! -name '*.backup-*' \
    | sort

  section "APPLICATION ROUTE MOUNTS"

  grep -RniE \
    'app\.use|router\.(get|post|patch|delete|use)' \
    src/core \
    src/modules \
    --include='*.ts' \
    --exclude='*.backup-*' \
    || true

  section "PLATFORM CONTRACT"

  grep -RniE \
    'platform/bootstrap|platform/capabilities|bootstrap|capabilities' \
    src/core \
    src/modules \
    --include='*.ts' \
    --exclude='*.backup-*' \
    || true

  section "MERCHANT PAYOUT"

  grep -RniE \
    'merchant_payout_requests|merchant_payout_events|merchant/payouts|merchant-payout|payouts/options|payouts/validate' \
    prisma \
    src \
    --include='*.sql' \
    --include='*.prisma' \
    --include='*.ts' \
    --exclude='*.backup-*' \
    || true

  section "SETTLEMENT"

  grep -RniE \
    'settlement_batches|settlement_items|settlement_policies|provider_webhook_events|admin/settlements|release|reconcile' \
    prisma \
    src \
    --include='*.sql' \
    --include='*.prisma' \
    --include='*.ts' \
    --exclude='*.backup-*' \
    || true

  section "ADMIN AUTHORIZATION"

  grep -RniE \
    'requirePlatformAdmin|platformAdmin|XPAY_ADMIN_MERCHANT_IDS' \
    src/core \
    src/modules \
    src/middleware \
    --include='*.ts' \
    --exclude='*.backup-*' \
    || true

  section "NOTIFICATIONS"

  grep -RniE \
    'notification_deliveries|Telegram|Discord|Resend|WhatsApp|retry' \
    src/modules \
    src/core \
    --include='*.ts' \
    --exclude='*.backup-*' \
    || true

  section "OPENAPI"

  find . \
    -maxdepth 4 \
    -type f \
    \( \
      -iname '*openapi*' \
      -o \
      -iname '*swagger*' \
    \) \
    ! -path './node_modules/*' \
    | sort

  section "TEST FILES"

  find . \
    -maxdepth 5 \
    -type f \
    \( \
      -name '*.test.ts' \
      -o \
      -name '*.spec.ts' \
    \) \
    ! -path './node_modules/*' \
    | sort
  section "TYPESCRIPT"

  npx tsc \
    --noEmit \
    --pretty false

  section "BUILD"

  npm run build

  section "LEDGER SNAPSHOT"

  npx tsx \
    scripts/inspect-authoritative-ledger.ts \
    || true

  section "RECENT APPLICATION LOGS"

  docker compose logs \
    --no-color \
    --tail=150 \
    xpay-expert-api

  section "AUDIT COMPLETE"

  echo "Report: $OUT"

echo
echo "Backend closure audit generated:"
echo "$OUT"
  section "TYPESCRIPT"

  npx tsc \
    --noEmit \
    --pretty false

  section "BUILD"

  npm run build

  section "LEDGER SNAPSHOT"

  npx tsx \
    scripts/inspect-authoritative-ledger.ts \
    || true

  section "RECENT APPLICATION LOGS"

  docker compose logs \
    --no-color \
    --tail=150 \
    xpay-expert-api

  section "AUDIT COMPLETE"

  echo "Report: $OUT"

echo
echo "Backend closure audit generated:"
echo "$OUT"
  section "TYPESCRIPT"

  npx tsc \
    --noEmit \
    --pretty false

  section "BUILD"

  npm run build

  section "LEDGER SNAPSHOT"

  npx tsx \
    scripts/inspect-authoritative-ledger.ts \
    || true

  section "RECENT APPLICATION LOGS"

  docker compose logs \
    --no-color \
    --tail=150 \
    xpay-expert-api

  section "AUDIT COMPLETE"

  echo "Report: $OUT"

echo
echo "Backend closure audit generated:"
echo "$OUT"
