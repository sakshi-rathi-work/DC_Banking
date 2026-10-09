#!/usr/bin/env bash
set -euo pipefail
if [ -z "${1:-}" ]; then
  echo "Usage: ./scripts/start-node.sh <node_id>"
  exit 1
fi
npm run node:start -- "$1"
