#!/usr/bin/env bash
# Empty the local development database, for a clean test. This only ever talks to the Docker
# container on this machine: it cannot reach the production database.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose up -d --wait db >/dev/null
docker compose exec -T db psql -q -U sokonipay -d sokonipay -c 'DROP SCHEMA IF EXISTS sokonipay CASCADE'
echo "Local database emptied. The tables are made again when the backend next starts."
echo "Shops opened locally are still on the NEAR testnet register; they just no longer appear in the local app."
