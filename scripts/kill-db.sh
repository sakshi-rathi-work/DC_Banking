#!/usr/bin/env bash
set -euo pipefail
if [ -z "${1:-}" ]; then
  echo "Usage: ./scripts/kill-db.sh <db_id>"
  exit 1
fi
npm run db:stop -- "$1"
