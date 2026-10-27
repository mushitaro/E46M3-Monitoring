#!/bin/bash
# Cloud sessions only: install the dependencies and put the private data where the checks read it.
#
# The data is BMW-derived and lives in the private repository E46M3-Monitoring-data, cloned beside
# this one when a session is given both (docs/PRESERVED.md has where each folder goes). Without it
# lint, typecheck, build and most tests still run; the tests that need it skip (src/lib/testing/
# shipped.ts), and this says so once rather than failing.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

# npm ci only when the installed tree is missing or older than the lock: it deletes node_modules,
# and the container keeps what this hook leaves.
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --no-audit --no-fund
fi

# Cloned by hand it is `E46M3-Monitoring-data`; attached to a session it lands lowercase.
DATA="$REPO/../E46M3-Monitoring-data"
[ -d "$DATA/ecu-data" ] || DATA="$REPO/../e46m3-monitoring-data"
if [ -d "$DATA/ecu-data" ]; then
  mkdir -p public/ecu-data tools/terms recordings
  cp -r "$DATA/ecu-data/." public/ecu-data/
  cp -r "$DATA/terms/." tools/terms/
  cp -r "$DATA/recordings/." recordings/
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "export SGBD_DUMP_DIR=\"$(cd "$DATA/sgbd-dumps" && pwd)\"" >> "$CLAUDE_ENV_FILE"
  fi
  echo "E46M3-Monitoring: private data placed from $DATA"
else
  echo "E46M3-Monitoring: no E46M3-Monitoring-data beside this repository; data-dependent tests will skip"
fi
