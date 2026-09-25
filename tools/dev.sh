#!/usr/bin/env bash
# Bring the whole device up locally: daemon, then UI.
#
# The order is not cosmetic. The UI reads the attestation on load, and a UI that
# started first would render its "no daemon" state and stay there. Starting the
# daemon first also means a failed verification stops everything here, which is
# the same thing that happens on the device.
#
# This script is careful about cleanup because the previous version was not, and
# the failure was nasty in a specific way: it ended with `exec npx vite`, which
# replaced the shell and threw away the EXIT trap along with it. The daemon and
# the Vite server were then orphaned on Ctrl-C, and the NEXT `make dev` died on
# "Port 5180 is already in use" with a Vite stack trace that says nothing about
# the real cause. Two rules follow from that, and both matter more than they
# look:
#
#   1. Never exec away the shell that owns the trap. Background the UI and wait.
#   2. Kill the whole child tree, not the process we happen to hold a pid for.
#      npm and npx fork, so killing the wrapper leaves the real server running.
set -euo pipefail

SOCKET="${NULLROUTE_SOCKET:-/tmp/nullrouted.sock}"
UI_PORT="${NULLROUTE_UI_PORT:-5180}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Kill a process and everything below it. `npx` spawns the real binary as a
# child, so killing the pid we started leaves the server holding the port, which
# is exactly how the orphan this guards against was created.
kill_tree() {
  local pid="$1"
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  if [[ -n "${UI_PID:-}" ]]; then kill_tree "$UI_PID"; fi
  if [[ -n "${DAEMON_PID:-}" ]]; then kill_tree "$DAEMON_PID"; fi
  rm -f "$SOCKET"
}
trap cleanup EXIT INT TERM

# --- Refuse to start on top of a previous run ------------------------------
# Say what is wrong and how to fix it. The default failure here is a Vite stack
# trace about a port, which tells a user nothing about the stale daemon that is
# also still running.
if command -v lsof >/dev/null 2>&1; then
  HOLDER="$(lsof -nP -iTCP:"$UI_PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [[ -n "$HOLDER" ]]; then
    echo "nullroute: port $UI_PORT is already in use by pid(s): $HOLDER" >&2
    echo "" >&2
    echo "  That is almost certainly a previous 'make dev' that did not shut down." >&2
    echo "  Stop it with:" >&2
    echo "" >&2
    echo "    kill $HOLDER" >&2
    echo "" >&2
    echo "  Or run this one on a different port:" >&2
    echo "" >&2
    echo "    NULLROUTE_UI_PORT=5181 make dev" >&2
    exit 1
  fi
fi

# A socket file left behind by a crash is harmless to delete. One with a live
# daemon behind it is not, because removing it would strand that process.
if [[ -S "$SOCKET" ]]; then
  if command -v lsof >/dev/null 2>&1 && lsof -nP "$SOCKET" >/dev/null 2>&1; then
    echo "nullroute: a daemon is already listening on $SOCKET." >&2
    echo "  Stop it first:  lsof -nP -t $SOCKET | xargs kill" >&2
    exit 1
  fi
  rm -f "$SOCKET"
fi

# NOT --jitless, and the reason is measured rather than assumed.
#
# This used to pass --jitless "matching the production systemd unit". There is
# no such unit, and provisioning/HARDENING.md says plainly that
# MemoryDenyWriteExecute is absent because it crashes Node. So the flag was
# matching a thing that does not exist.
#
# It also stopped being free. Argon2id from @noble/hashes is pure JavaScript,
# and the wallet store derives its key at 64 MiB with three passes. Measured on
# this machine: 643 ms with the JIT, 34424 ms without it. That is 53x, and on a
# Raspberry Pi it would be minutes per unlock attempt. The claim in
# HARDENING.md that jitless is "an acceptable trade for a workload that is
# not throughput bound" was true before there was a memory-hard KDF in the
# daemon and is not true now.
NULLROUTE_SOCKET="$SOCKET" node "$ROOT/packages/daemon/dist/main.js" &
DAEMON_PID=$!

for _ in $(seq 1 50); do
  [[ -S "$SOCKET" ]] && break
  # The daemon refuses to start on a failed verification. Notice that it has
  # exited rather than waiting out the full timeout to say nothing useful.
  if ! kill -0 "$DAEMON_PID" 2>/dev/null; then break; fi
  sleep 0.1
done

if [[ ! -S "$SOCKET" ]]; then
  echo "" >&2
  echo "nullroute: the daemon did not come up. It refuses to start without a passing" >&2
  echo "verification report, so try: make verify" >&2
  exit 1
fi

echo ""
echo "  device UI  http://127.0.0.1:$UI_PORT"
echo "  daemon     $SOCKET"
echo ""
echo "  Ctrl-C stops both."
echo ""

# Backgrounded, not exec'd, so the trap above survives to do the cleanup. The
# binary is invoked directly rather than through npx: one less wrapper process
# between us and the thing holding the port.
cd "$ROOT/packages/ui"
NULLROUTE_SOCKET="$SOCKET" "$ROOT/node_modules/.bin/vite" --port "$UI_PORT" --strictPort &
UI_PID=$!

# Exit as soon as either half dies, rather than sitting on a half-running
# device. `wait -n` needs bash 4; macOS ships bash 3.2, so poll instead.
while kill -0 "$DAEMON_PID" 2>/dev/null && kill -0 "$UI_PID" 2>/dev/null; do
  sleep 0.5
done
