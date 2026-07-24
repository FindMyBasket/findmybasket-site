#!/usr/bin/env bash
#
# secret-divergence-check.sh — detect the same credential drifting apart across
# the stores that hold copies of it, WITHOUT ever reading plaintext.
#
# Why this exists: on 2026-07-24 we found four credentials with copies out of
# sync in one day (service-role key: Vault vs edge secret; Resend key: Auth SMTP
# vs edge secret; plus a branch-deploy clobber of the same shape). One source of
# truth got updated, another didn't. That is structural, not coincidence.
#
# The trick that makes this checkable safely: the Supabase edge-secrets API
# returns the plain, unsalted SHA-256 of each secret's value (verified against a
# known plaintext: sha256 of the project URL equals the reported digest). Vault
# secrets are readable in plaintext over the management SQL API, so we hash them
# in-database with pgcrypto. Same hash function on both sides => a digest match
# proves the values are identical; a mismatch proves drift. No plaintext leaves
# the database.
#
# What it checks:
#   1. CROSS-STORE PAIRS — secrets that exist in >1 store and MUST be identical
#      (currently: Vault.service_role_key == edge.SUPABASE_SERVICE_ROLE_KEY).
#   2. TIMESTAMP SKEW — any edge secret whose updated_at lags the newest by more
#      than STALE_DAYS, i.e. it likely missed a rotation the others got.
#
# Stores it CANNOT digest-compare (reported here for a human/manual check):
#   - Auth SMTP smtp_pass: masked by a different endpoint, hashing unverified, so
#     its digest is not comparable to the edge RESEND_API_KEY digest. We surface
#     the pair + the timestamp signal instead.
#   - GitHub Actions secrets: write-only, no value or digest is ever returned.
#
# Exit code: 0 = no divergence found; 1 = at least one divergence (for CI).
#
# Requires: bash, curl, jq. Env:
#   SUPABASE_ACCESS_TOKEN  (or ~/.supabase/access-token)
#   SUPABASE_PROJECT_REF   (default: crtrjoescntlcjiwdtrt)
#   STALE_DAYS             (default: 45)

set -euo pipefail

REF="${SUPABASE_PROJECT_REF:-crtrjoescntlcjiwdtrt}"
STALE_DAYS="${STALE_DAYS:-45}"
TOKEN="${SUPABASE_ACCESS_TOKEN:-$(cat "${HOME}/.supabase/access-token" 2>/dev/null || true)}"

if [[ -z "${TOKEN}" ]]; then
  echo "ERROR: no access token (set SUPABASE_ACCESS_TOKEN or ~/.supabase/access-token)" >&2
  exit 2
fi

api()     { curl -sS -H "Authorization: Bearer ${TOKEN}" "https://api.supabase.com/v1/projects/${REF}$1"; }
run_sql() { curl -sS -X POST "https://api.supabase.com/v1/projects/${REF}/database/query" \
              -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
              -d "$(jq -Rn --arg q "$1" '{query:$q}')"; }

# ── Pairs that MUST match. Format: "label|store_a:name_a|store_b:name_b"
#    stores: edge (edge-function secrets) | vault (Vault). Extend as new shared
#    secrets appear. Keep this list as the registry of "which secret lives where".
#    A mismatch here is a HARD failure (exit 1) — these are the real detector.
PAIRS=(
  "service-role key|vault:service_role_key|edge:SUPABASE_SERVICE_ROLE_KEY"
)

# ── Secrets that are legitimately static (config/URLs, provider keys that rarely
#    rotate). Timestamp skew on these is expected and must NOT flag — otherwise
#    the standing check goes permanently red and stops being read. Space list.
SKEW_IGNORE="${SKEW_IGNORE:-APP_BASE_URL AWIN_API_KEY AWIN_PUBLISHER_ID SUPABASE_DB_URL}"

# ── Pull both stores as name<TAB>digest<TAB>updated_at ───────────────────────
EDGE="$(api /secrets | jq -r '.[] | [.name, .value, (.updated_at // "")] | @tsv')"
VAULT="$(run_sql "select name, encode(extensions.digest(decrypted_secret,'sha256'),'hex') as sha256, updated_at from vault.decrypted_secrets order by name;" \
          | jq -r '.[] | [.name, .sha256, (.updated_at // "")] | @tsv')"

digest_of() { # digest_of <store> <name>
  local store="$1" name="$2" src
  src="$([[ "$store" == edge ]] && echo "$EDGE" || echo "$VAULT")"
  awk -F'\t' -v n="$name" '$1==n{print $2; found=1} END{if(!found)print ""}' <<<"$src"
}
updated_of() {
  local store="$1" name="$2" src
  src="$([[ "$store" == edge ]] && echo "$EDGE" || echo "$VAULT")"
  awk -F'\t' -v n="$name" '$1==n{print $3}' <<<"$src"
}

DIVERGENCE=0

echo "=================================================================="
echo " Secret divergence check — project ${REF}"
echo "=================================================================="
echo
echo "── Cross-store pairs (digest must match) ─────────────────────────"
for row in "${PAIRS[@]}"; do
  IFS='|' read -r label a b <<<"$row"
  IFS=':' read -r sa na <<<"$a"; IFS=':' read -r sb nb <<<"$b"
  da="$(digest_of "$sa" "$na")"; db="$(digest_of "$sb" "$nb")"
  if [[ -z "$da" || -z "$db" ]]; then
    printf "  ?  %-22s MISSING in one store (%s:%s=%s, %s:%s=%s)\n" \
      "$label" "$sa" "$na" "${da:0:8}" "$sb" "$nb" "${db:0:8}"
    DIVERGENCE=1
  elif [[ "$da" == "$db" ]]; then
    printf "  OK %-22s match (%s…)\n" "$label" "${da:0:8}"
  else
    printf "  ✗  %-22s DIVERGENT\n" "$label"
    printf "        %s:%-28s %s  (updated %s)\n" "$sa" "$na" "${da:0:12}" "$(updated_of "$sa" "$na")"
    printf "        %s:%-28s %s  (updated %s)\n" "$sb" "$nb" "${db:0:12}" "$(updated_of "$sb" "$nb")"
    DIVERGENCE=1
  fi
done

echo
echo "── Timestamp skew in edge secrets (> ${STALE_DAYS}d behind newest) ─"
echo "   (warning only — does not fail CI; investigate against known rotations)"
NEWEST_EPOCH="$(awk -F'\t' '$3!=""{print $3}' <<<"$EDGE" | while read -r d; do date -d "$d" +%s 2>/dev/null || true; done | sort -nr | head -1)"
if [[ -n "${NEWEST_EPOCH:-}" ]]; then
  while IFS=$'\t' read -r name _digest updated; do
    [[ -z "$updated" ]] && continue
    [[ " $SKEW_IGNORE " == *" $name "* ]] && continue   # legitimately static
    e="$(date -d "$updated" +%s 2>/dev/null || echo 0)"
    age_days=$(( (NEWEST_EPOCH - e) / 86400 ))
    if (( age_days > STALE_DAYS )); then
      printf "  ⚠  %-30s %sd behind newest (updated %s)\n" "$name" "$age_days" "${updated%%.*}"
    fi
  done <<<"$EDGE"
fi

echo
echo "── Not digest-comparable (manual check) ──────────────────────────"
echo "  Auth SMTP smtp_pass  vs  edge RESEND_API_KEY  — different endpoints;"
echo "  verify by: printf '%s' '<working resend key>' | sha256sum  =="
echo "             $(digest_of edge RESEND_API_KEY)"
echo

if (( DIVERGENCE )); then
  echo "RESULT: DIVERGENCE FOUND — reconcile the flagged secrets."
  exit 1
fi
echo "RESULT: no divergence detected."
