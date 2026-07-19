#!/usr/bin/env bash
#
# Prove the Superdrug removal gate end-to-end on the DEPLOYED site, BEFORE the flip.
#
# A bare "does it 200?" check is ambiguous — a Superdrug-orphan URL 200s both when the
# middleware ran and stayed inert (correct) AND when the middleware never fired at all
# (broken). This resolves that by reading the x-fmb-superdrug-gate header the middleware
# sets on every /product response:
#
#   HTTP 200 + gate=inert            -> middleware EXECUTED, EDGE_CONFIG READABLE, flag=false  ✅
#   HTTP 200 + gate=<absent>         -> middleware NOT running on the route (matcher/deploy problem)
#   HTTP 200 + gate=flag-unreadable  -> middleware runs but EDGE_CONFIG not connected (the disconnect)
#   anything else                    -> unexpected; do not flip
#
# Usage: scripts/verify-superdrug-gate.sh [BASE_URL]
#   BASE_URL defaults to the production domain; pass a preview URL to check a preview.
set -uo pipefail

BASE="${1:-https://www.findmybasket.co.uk}"
HDR="x-fmb-superdrug-gate"
# Known GONE_IDS members (first three orphan ids); live 200 pages pre-flip.
ORPHANS=(650 711 732)

echo "Checking Superdrug gate on: $BASE"
fail=0
for id in "${ORPHANS[@]}"; do
  headers=$(curl -sS -m 20 -o /dev/null -D - "$BASE/product/$id" 2>/dev/null)
  code=$(printf '%s' "$headers" | awk 'NR==1{print $2}')
  gate=$(printf '%s' "$headers" | tr -d '\r' | awk -F': ' 'tolower($1)=="'"$HDR"'"{print $2}')
  printf '  /product/%-7s HTTP %-3s  %s=%s\n' "$id" "${code:-?}" "$HDR" "${gate:-<absent>}"
  [ "$code" = "200" ] || { echo "    x expected HTTP 200 (orphan is live pre-flip)"; fail=1; }
  case "$gate" in
    inert) : ;;
    "")               echo "    x header ABSENT -> middleware not executing on /product routes"; fail=1 ;;
    flag-unreadable)  echo "    x EDGE_CONFIG unreadable -> Edge Config store not connected to the project"; fail=1 ;;
    *)                echo "    x unexpected gate '$gate' -> flag should read false pre-flip"; fail=1 ;;
  esac
done

echo
if [ "$fail" = 0 ]; then
  echo "PASS: gate is live-and-inert. Middleware executes, EDGE_CONFIG is readable, flag=false."
  echo "Flip-ready pending GSC export -> REDIRECTS build -> GONE_IDS regen."
else
  echo "FAIL: chain NOT proven. Do not flip until the failure above is resolved."
fi
exit $fail
