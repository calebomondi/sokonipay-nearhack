#!/usr/bin/env bash
# Start the API (8010), the customer app (5173) and the merchant console (5174). Ctrl-C stops all three.
set -euo pipefail
cd "$(dirname "$0")/.."
trap 'kill 0' EXIT
(cd backend && uv run uvicorn app.main:app --port 8010) &
(cd apps && npm run dev:customer) &
(cd apps && npm run dev:merchant) &
wait
