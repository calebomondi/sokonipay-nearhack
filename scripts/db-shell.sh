#!/usr/bin/env bash
# A SQL prompt on the local development database. Try:  \dt sokonipay.*   or   select name, status from sokonipay.shops;
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose up -d --wait db >/dev/null
exec docker compose exec db psql -U sokonipay -d sokonipay
