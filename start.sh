#!/usr/bin/env bash
# Start Studio 64 and open it in the browser (the same as npm start).
#   ./start.sh                                         local only (http://localhost:8064)
#   HOST=0.0.0.0 STUDIO_PASSWORD=secret ./start.sh     reachable from your network
# On a fresh checkout the browser shows the first-run setup: drop your ROM, the rest is automatic.
set -euo pipefail
cd "$(dirname "$0")"
exec node tools/start.mjs
