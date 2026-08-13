#!/usr/bin/env bash
# Bring the whole device up locally: daemon, then UI.
#
# The order is not cosmetic. The UI reads the attestation on load, and a UI that
# started first would render its "no daemon" state and stay there. Starting the
# daemon first also means a failed verification stops everything here, which is
# the same thing that happens on the device.
set -euo pipefail

SOCKET="${NULLROUTE_SOCKET:-/tmp/nullrouted.sock}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  [[ -n "${DAEMON_PID:-}" ]] && kill "$DAEMON_PID" 2>/dev/null || true
  rm -f "$SOCKET"
}
trap cleanup EXIT INT TERM

rm -f "$SOCKET"

# --jitless, matching the production systemd unit, which sets
# MemoryDenyWriteExecute=true and crashes V8's baseline compiler otherwise.
# Running it the same way locally means that crash surfaces here.
NULLROUTE_SOCKET="$SOCKET" node --jitless "$ROOT/packages/daemon/dist/main.js" &
DAEMON_PID=$!

for _ in $(seq 1 50); do
  [[ -S "$SOCKET" ]] && break
  sleep 0.1
done

if [[ ! -S "$SOCKET" ]]; then
  echo "nullroute: the daemon did not come up. It refuses to start without a passing" >&2
  echo "verification report, so try: make verify" >&2
  exit 1
fi

echo ""
echo "  device UI  http://127.0.0.1:5180"
echo "  daemon     $SOCKET"
echo ""

cd "$ROOT/packages/ui"
NULLROUTE_SOCKET="$SOCKET" exec npx vite
