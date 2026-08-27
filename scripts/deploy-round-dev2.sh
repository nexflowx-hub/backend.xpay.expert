#!/usr/bin/env bash
set -Eeuo pipefail

cd /root/xpay-expert-backend

npx tsc --noEmit --pretty false
npm run build

docker compose \
  -f docker-compose.yml \
  -f docker-compose.round-dev2.yml \
  config >/tmp/xpay-round-dev2-compose.yml

docker compose \
  -f docker-compose.yml \
  -f docker-compose.round-dev2.yml \
  build --no-cache

docker compose \
  -f docker-compose.yml \
  -f docker-compose.round-dev2.yml \
  up -d

READY=false

for attempt in $(seq 1 30); do
  if curl -fsS \
    https://api.xpay.expert/api/health \
    >/tmp/xpay-round-dev2-health.json 2>/dev/null
  then
    READY=true
    break
  fi

  sleep 2
done

if [ "$READY" != "true" ]; then
  docker compose logs --no-color --tail=300
  exit 1
fi

jq . /tmp/xpay-round-dev2-health.json

echo
echo "Unauthenticated security route check:"
curl -sS -o /tmp/security-response.txt -w '%{http_code}\n' \
  https://api.xpay.expert/api/v1/security/purposes
cat /tmp/security-response.txt

echo
echo "Unauthenticated banking route check:"
curl -sS -o /tmp/banking-response.txt -w '%{http_code}\n' \
  https://api.xpay.expert/api/v1/banking/capabilities
cat /tmp/banking-response.txt

docker compose logs --no-color --tail=150 xpay-expert-api
