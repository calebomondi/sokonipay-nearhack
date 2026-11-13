#!/usr/bin/env bash
# Run everything locally: the database (Docker), the backend on :8010, the user app on :5173 and the console on :5174.
set -euo pipefail
cd "$(dirname "$0")/.."

# The local database, unless backend/.env points somewhere else.
if grep -qE '^DATABASE_URL=.*(localhost|127\.0\.0\.1)' backend/.env 2>/dev/null; then
  echo "Starting the local database (Docker)…"
  docker compose up -d --wait db
else
  echo "backend/.env has no local DATABASE_URL, so the backend uses the database in SUPABASE_DB_CONN_STR."
fi

trap 'kill 0' EXIT
(cd backend && uv run uvicorn app.main:app --port 8010) &
(cd apps && npm run dev:customer) &
(cd apps && npm run dev:merchant) &
wait
