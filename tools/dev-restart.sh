#!/usr/bin/env bash
# Tear the local device down and bring it back up, in one step.
#
# WHY THIS EXISTS. `make dev` REFUSES to start on top of a previous run: it
# prints the pids holding the port and tells you to kill them. That is the right
# default for a script that might be stepping on something you meant to keep
# running, and it is the wrong thing to have to do twenty times an afternoon.
# This is the other half: stop whatever is running, then start clean.
#
# IT DOES NOT DEPLOY ANYTHING. `make deploy` publishes the website to
# nullroute.diy, and it has nothing to do with running the device locally. If
# you have been running it before `make dev`, you have been shipping to
# production to test on your own machine.
#
# WALLETS SURVIVE BY DEFAULT. The local store is a directory of real encrypted
# wallets, and a restart that silently erased them would be a restart nobody
# could trust. FRESH=1 wipes it, says so first, and names the directory.
set -euo pipefail

SOCKET="${NULLROUTE_SOCKET:-/tmp/nullrouted.sock}"
UI_PORT="${NULLROUTE_UI_PORT:-5180}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STORE="${NULLROUTE_STORE:-$ROOT/.nullroute-store}"
FRESH="${FRESH:-0}"

say() { printf '  %s\n' "$1"; }

echo ""
echo "nullroute: restarting the local device"
echo ""

# --- Stop whatever is running ----------------------------------------------
#
# The whole tree, not the pid we happen to know: npx and npm fork, so killing a
# wrapper leaves the real server holding the port. This is the same failure the
# dev script's own comments describe.
stopped=0

if command -v lsof >/dev/null 2>&1; then
  holders="$(lsof -nP -iTCP:"$UI_PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [[ -n "$holders" ]]; then
    for pid in $holders; do
      # SIGTERM first so the dev script's own EXIT trap gets to run and clean
      # up its daemon. SIGKILL would orphan exactly what this is here to stop.
      kill "$pid" 2>/dev/null || true
      stopped=$((stopped + 1))
    done
    say "stopped $stopped process(es) on port $UI_PORT"
  fi

  daemons="$(lsof -nP "$SOCKET" -t 2>/dev/null || true)"
  if [[ -n "$daemons" ]]; then
    for pid in $daemons; do
      kill "$pid" 2>/dev/null || true
    done
    say "stopped the daemon on $SOCKET"
  fi
fi

# Anything started outside a dev script, which lsof will not associate with the
# port if it died mid-startup. Matched narrowly on this repo's own paths so a
# node process of yours is never in the blast radius.
pkill -f "$ROOT/packages/daemon/dist/main.js" 2>/dev/null || true
pkill -f "vite --port $UI_PORT" 2>/dev/null || true

# Give the traps a moment to release the port before the new run claims it.
for _ in $(seq 1 30); do
  if command -v lsof >/dev/null 2>&1; then
    [[ -z "$(lsof -nP -iTCP:"$UI_PORT" -sTCP:LISTEN -t 2>/dev/null || true)" ]] && break
  else
    break
  fi
  sleep 0.1
done

rm -f "$SOCKET"

# --- Optionally start from an empty device ---------------------------------
if [[ "$FRESH" == "1" ]]; then
  if [[ -d "$STORE" ]]; then
    wallets="$(find "$STORE" -name 'wallet.store' 2>/dev/null | wc -l | tr -d ' ')"
    say "FRESH=1: erasing $wallets wallet(s) in $STORE"
    rm -rf "$STORE"
  else
    say "FRESH=1: no store at $STORE, nothing to erase"
  fi
else
  if [[ -d "$STORE" ]]; then
    wallets="$(find "$STORE" -name 'wallet.store' 2>/dev/null | wc -l | tr -d ' ')"
    say "keeping $wallets wallet(s) in $STORE  (FRESH=1 to erase)"
  fi
fi

echo ""

# --- Build, verify, run -----------------------------------------------------
#
# Through make, so this cannot drift from what `make dev` does. The daemon
# refuses to start without a passing verification report, so building and
# verifying here means a failure is reported as itself rather than as a daemon
# that would not come up.
exec make -C "$ROOT" dev
