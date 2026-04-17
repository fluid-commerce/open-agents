#!/usr/bin/env bash
# Idempotent: installs Linear SDK if not present.
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d node_modules/@linear/sdk ]; then
  bun install --silent
fi
