#!/usr/bin/env bash
set -euo pipefail
if [ -z "${1:-}" ]; then
  echo "Usage: ./scripts/kill-node.sh <node_id>"
  exit 1
fi
npm run node:stop -- "$1"
