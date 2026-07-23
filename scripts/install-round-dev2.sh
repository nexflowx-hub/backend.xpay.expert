#!/usr/bin/env bash
set -Eeuo pipefail

cd /root/xpay-expert-backend

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="backups/round-dev2-${STAMP}"

mkdir -p "$BACKUP"
cp -a \
  src \
  package.json \
  package-lock.json \
  docker-compose.yml \
  .env \
  "$BACKUP"/ \
  2>/dev/null || true

npm install pg jsonwebtoken
npm install -D @types/pg @types/jsonwebtoken

python3 scripts/patch-app-round-dev2.py

python3 <<'PY'
from pathlib import Path
import secrets

path = Path(".env")
lines = path.read_text().splitlines() if path.exists() else []

values = {
    "XPAY_DB_SSL": "true",
    "XPAY_DB_POOL_MAX": "10",
    "XPAY_NOTIFICATION_BATCH_SIZE": "20",
    "XPAY_NOTIFICATION_POLL_MS": "5000",
    "XPAY_EMAIL_FROM": '"XPAY.Expert <security@xpay.expert>"',
    "XPAY_S2S_IDEMPOTENCY_ENABLED": "true",
    "XPAY_S2S_IDEMPOTENCY_REQUIRED": "false",
    "XPAY_BANKING_ENABLED": "false",
    "XPAY_BANKING_PROVIDER_MODE": "manual",
    "XPAY_PAYOUT_SECURITY_CHALLENGE_REQUIRED": "false",
}

positions = {
    line.split("=", 1)[0]: index
    for index, line in enumerate(lines)
    if "=" in line and not line.lstrip().startswith("#")
}

for key, value in values.items():
    line = f"{key}={value}"

    if key in positions:
        lines[positions[key]] = line
    else:
        lines.append(line)

for key in [
    "XPAY_SECURITY_CHALLENGE_SECRET",
    "XPAY_SECURITY_ACTION_TOKEN_SECRET",
    "XPAY_API_KEY_HASH_PEPPER",
]:
    if key not in positions:
        lines.append(f"{key}={secrets.token_urlsafe(48)}")

path.write_text("\n".join(lines) + "\n")
print("Environment defaults written.")
print("RESEND_API_KEY must be configured separately.")
PY

npx tsc --noEmit --pretty false
npm run build

echo
echo "Source installation completed."
echo "Do not deploy before applying and validating the SQL migration."
