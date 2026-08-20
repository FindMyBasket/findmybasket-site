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
# What it checks (CHANGED 2026-08-18 — work-list item 196):
#   1. REGISTERED COPIES — each copy in COPIES must still hash to its declared pin.
#      This replaced a cross-store equality assertion that went false when Supabase
#      shipped a second key format. See the long note above COPIES for why equality
#      cannot be repaired and had to be replaced by a different relation.
#   2. AGE — any edge secret not rotated in STALE_DAYS. ADVISORY, never fails CI.
#      Measured against NOW, not against the newest sibling: the old form made every
#      other secret look stale the day any one was rotated.
#
# Stores it CANNOT digest-compare (reported here for a human/manual check):
#   - Auth SMTP smtp_pass: masked by a different endpoint, hashing unverified, so
#     its digest is not comparable to the edge RESEND_API_KEY digest. We surface
#     the pair + the timestamp signal instead.
#   - GitHub Actions secrets: write-only, no value or digest is ever returned.
#
# ── EXIT CODES. CHANGED 19 AUGUST -- WORK-LIST ITEM 194. ────────────────────────────
#
# This script used to exit 1 on any divergence, which made "I found something" and "I am
# broken" the same red tick. They demand opposite responses and the one that was WORKING
# got ignored 25 days against 14 (item 191).
#
#   0  ok, or findings recorded  -- THE REPORTER PATH. Findings go to
#                                   standing_check_findings and reach a human through the
#                                   daily monitor email, which is already read.
#   1  CANNOT RUN                -- no token, store unreachable, registry malformed.
#                                   The check is DEAD and that is what red now means.
#   1  ESCALATED                 -- a finding reported ESCALATION_REPORTS times without
#                                   changing. NOT a severity judgement: it means THE
#                                   REPORTING CHANNEL IS NOT WORKING, which is a fact about
#                                   the channel and therefore a uniform rule.
#   2  usage error
#
# gone-ids-drift already worked this way -- it detects, opens a PR, and fails only when a
# human must judge. This makes the outlier match the case that got it right.
#
# Requires: bash, curl, jq. Env:
#   SUPABASE_ACCESS_TOKEN  (or ~/.supabase/access-token)
#   SUPABASE_PROJECT_REF   (default: crtrjoescntlcjiwdtrt)
#   STALE_DAYS             (default: 180 — see note below; this is a POLICY number)

set -euo pipefail

REF="${SUPABASE_PROJECT_REF:-crtrjoescntlcjiwdtrt}"
# 180 IS A PLACEHOLDER AWAITING A DECISION, NOT A DERIVED THRESHOLD.
#
# THE HONEST POSITION: there is no rotation policy for these credentials, so any number here
# is arbitrary until there is one. Nothing in this script — or in the repository — can derive
# it, because it is not a fact about the system. It is a statement about how often these
# credentials OUGHT to be rotated, and nobody has made that statement.
#
# WHY 180 SPECIFICALLY: it does not fire today. That is the entire justification, and it is a
# deliberate one — the section is advisory, and an advisory section that shouts on every run
# is how this script's other rule turned a working detector into background (item 196). 180
# keeps the output readable while the question stays open.
#
# IT WILL NEED RE-DECIDING RATHER THAN TUNING. If it starts firing, the answer is not to raise
# it until it stops; that is how a threshold becomes a number chosen to produce silence. The
# answer is to decide the rotation policy it is standing in for.
#
# It was 45 when the rule measured distance from the newest sibling. As an ABSOLUTE age, 45
# days would flag nearly everything and rebuild the noise item 196 removed.
STALE_DAYS="${STALE_DAYS:-180}"

# Three weekly reports. A POLICY NUMBER, NOT A DERIVED ONE -- re-decide rather than tune.
ESCALATION_REPORTS="${ESCALATION_REPORTS:-3}"
CHECK_NAME="secret-divergence"
TOKEN="${SUPABASE_ACCESS_TOKEN:-$(cat "${HOME}/.supabase/access-token" 2>/dev/null || true)}"

if [[ -z "${TOKEN}" ]]; then
  echo "CANNOT RUN: no access token (set SUPABASE_ACCESS_TOKEN or ~/.supabase/access-token)" >&2
  exit 1
fi

api()     { curl -sS -H "Authorization: Bearer ${TOKEN}" "https://api.supabase.com/v1/projects/${REF}$1"; }
run_sql() { curl -sS -X POST "https://api.supabase.com/v1/projects/${REF}/database/query" \
              -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
              -d "$(jq -Rn --arg q "$1" '{query:$q}')"; }

# ── THE REGISTRY. Changed 2026-08-18 from pairs to copies — see work-list item 196.
#
# WHAT WAS HERE BEFORE, AND WHY IT WAS REPLACED RATHER THAN EXTENDED.
#
#   PAIRS=( "service-role key|vault:service_role_key|edge:SUPABASE_SERVICE_ROLE_KEY" )
#
# That asserted digest(vault.x) == digest(edge.y): the two copies must be byte-identical.
# It was CORRECT WHEN WRITTEN and went false on 2026-08-17 without a line of this
# repository changing — Supabase shipped a second key format, the edge copy became the
# new sb_secret_… key, the Vault copy stayed the legacy service_role JWT, and BOTH ARE
# VALID. ~20 pg_cron jobs authenticate with the Vault copy; edge functions use theirs.
#
# So the check went red for five weeks on a project with nothing wrong with it.
#
# WHY "SAME CREDENTIAL, DIFFERENT FORMATS" CANNOT BE EXPRESSED HERE, EVER.
#
# Two formats of one authority produce UNRELATED digests, and no function of two digests
# can establish that they correspond. Digest equality proves byte-identity and nothing
# else. This is a property of hashing, not a limitation to engineer around — it forecloses
# the obvious next attempt, which is to make the pair cleverer.
#
# THE RELATION CHANGES INSTEAD:
#   was:  equal(a, b)             symmetric, between two copies, needs nothing external
#   now:  conforms(copy, pinned)  asymmetric, one copy against a declared fingerprint
#
# Pairwise equality was never the property of interest anyway. The question is "has a copy
# changed without the change being intended?", and equality was a proxy that only worked
# while both stores held one credential in one format.
#
# WHY A PIN AND NOT THE MANAGEMENT API'S ?reveal=true.
#
# Comparing each copy against the authoritative value would be stronger — it would catch a
# stale pin too. It also pulls PLAINTEXT INTO THIS RUNNER, destroying the property this
# whole script is built around: no plaintext leaves Postgres or reaches CI. Rejected.
#
# The pin's failure mode is "someone rotated something without recording it here", which is
# a TRUE red — and producing true reds is exactly what the old assertion stopped doing.
#
# ROTATING A CREDENTIAL IS THEREFORE A TWO-PART CHANGE: rotate it, and update its pin in
# the same commit. That is a feature. The registry is the only place that records which
# generation each store is expected to hold, and it had to be rediscovered by hashing a key
# by hand on 18 August because nothing wrote it down.
#
# Format: "store:name|role|generation|expected_sha256_prefix"   (prefix: >=12 hex chars)
COPIES=(
  "vault:service_role_key|service_role|legacy_jwt|aee0e4653b97"
  "edge:SUPABASE_SERVICE_ROLE_KEY|service_role|secret_key|77a2bb9723c4"
)

# ── A THIRD COPY EXISTS AND CANNOT BE PINNED. Added 19 August -- work-list item 220.
#
# `SUPABASE_SERVICE_KEY` is a GitHub Actions secret used by SEVEN workflows (awin-weekly-pull,
# gone-ids-drift, refresh-debenhams, sync-adg-feed, sync-bb-feed, ga4-weekly-pull, and the
# read-only probes). It is a third copy of the service-role credential and it was NOT in this
# registry until now.
#
# IT CANNOT BE DIGEST-COMPARED: Actions secrets are write-only and return neither value nor
# digest, as the header of this file already states. So it cannot join COPIES.
#
# BUT THE REGISTRY'S STATED PURPOSE IS "WHICH SECRET LIVES WHERE", AND IT WAS RECORDING TWO OF
# THREE STORES. An unregistered third copy is precisely the condition that made the original
# divergence hard to reason about -- and the reason item 196 had to hash a key by hand to work
# out which generation lived where. Recorded here as a known, uncomparable copy, exactly as the
# Auth SMTP smtp_pass pair already is.
#
# HOW MANY OF THESE EXIST: at least three, and the category already had a member before this
# list did. A registry with ONE ACKNOWLEDGED GAP is a different thing from one with several
# UNACKNOWLEDGED, and this file was the latter -- the Auth SMTP pair below proved the category
# existed while two other copies went unwritten. Item 222.
UNCOMPARABLE=(
  "gh-actions:SUPABASE_SERVICE_KEY|service_role|unknown generation — Actions secrets are write-only"
  "gh-actions:AWIN_API_KEY|awin|also an edge secret; Actions secrets are write-only"
)

# ── Secrets that are legitimately static (config/URLs, provider keys that rarely
#    rotate). Timestamp skew on these is expected and must NOT flag — otherwise
#    the standing check goes permanently red and stops being read. Space list.
#
#    2026-08-18: THAT SENTENCE WAS RIGHT AND DID NOT SAVE THIS SCRIPT. It went
#    permanently red for five weeks and stopped being read — not through this rule,
#    which is advisory and never failed CI, but through the equality assertion above.
#    The mechanism was correctly predicted and the guard was built one rule too narrow.
#    Work-list items 191 and 196.
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
# Findings, as key<TAB>summary. THE KEY MUST BE STABLE ACROSS RUNS -- no timestamps and no
# measured values in it, or every run creates a new row, report_count never rises, and the
# age escalation is silently disabled while looking like it works.
FINDINGS=()

echo "=================================================================="
echo " Secret divergence check — project ${REF}"
echo "=================================================================="
echo
echo "── Registered copies (digest must match its pin) ─────────────────"
for row in "${COPIES[@]}"; do
  IFS='|' read -r ref role generation pin <<<"$row"
  IFS=':' read -r store name <<<"$ref"
  got="$(digest_of "$store" "$name")"
  n="${#pin}"
  if [[ -z "$got" ]]; then
    # ABSENT IS NOT "UNCHANGED". A registered copy that has vanished from its store is a
    # finding, and the old code could only see this as one half of a pair.
    printf "  ?  %-34s MISSING from store  (role %s, expected %s…)\n" "$ref" "$role" "$pin"
    FINDINGS+=("missing:${ref}"$'\t'"${ref} is registered but absent from its store (role ${role})")
    DIVERGENCE=1
  elif [[ "${got:0:$n}" == "$pin" ]]; then
    printf "  OK %-34s %s…  %s / %s\n" "$ref" "$pin" "$role" "$generation"
  else
    printf "  ✗  %-34s PIN MISMATCH\n" "$ref"
    printf "        expected  %s…  (%s / %s)\n" "$pin" "$role" "$generation"
    printf "        found     %s…  (updated %s)\n" "${got:0:$n}" "$(updated_of "$store" "$name")"
    printf "        → the value changed, or it was rotated without updating the pin here.\n"
    FINDINGS+=("pin:${ref}"$'\t'"${ref} does not match its pin (${role}/${generation}); rotated without updating the registry, or changed")
    DIVERGENCE=1
  fi
done

# ── ROLE COVERAGE. The old pair form implied "these two serve the same role" as a side
#    effect of asserting equality. Losing that would lose real information, so it is now
#    stated explicitly instead of inferred from a comparison that no longer holds.
echo
echo "── Roles and the generations registered for them ─────────────────"
printf '%s\n' "${COPIES[@]}" | awk -F'|' '{split($1,r,":"); print $2"\t"$3"\t"r[1]}' \
  | sort | awk -F'\t' '{a[$1]=a[$1]"  "$3"("$2")"} END{for(k in a) printf "  %-14s%s\n", k, a[k]}'

echo
echo "── Age of edge secrets (> ${STALE_DAYS}d since last rotation) ─────"
echo "   (advisory only — never fails CI. Belongs in the reporter, work-list item 194.)"
#
# MEASURED AGAINST NOW, NOT AGAINST THE NEWEST SIBLING. Changed 2026-08-18, item 196.
#
# It used to compute (newest_edge_secret_updated_at − this_secret_updated_at), which makes
# EVERY OTHER SECRET LOOK STALE THE DAY ANY ONE IS ROTATED. On 17 August the service-role
# edge secret was updated and REVALIDATE_SECRET — unchanged, with all three of its copies
# dated 17 June and no newer value anywhere — was reported as "60d behind newest".
#
# That is a stable secret, not skew. A relative measure was being presented as an absolute
# one, and it was the second false positive this script produced in one investigation.
# Absolute age says "not rotated in N days", which is true, and is either actionable or
# ignorable on policy rather than on mood.
NEWEST_EPOCH="$(date -u +%s)"
if [[ -n "${NEWEST_EPOCH:-}" ]]; then
  while IFS=$'\t' read -r name _digest updated; do
    [[ -z "$updated" ]] && continue
    [[ " $SKEW_IGNORE " == *" $name "* ]] && continue   # legitimately static
    e="$(date -d "$updated" +%s 2>/dev/null || echo 0)"
    age_days=$(( (NEWEST_EPOCH - e) / 86400 ))
    if (( age_days > STALE_DAYS )); then
      printf "  ⚠  %-30s not rotated in %sd (last %s)\n" "$name" "$age_days" "${updated%%.*}"
    fi
  done <<<"$EDGE"
fi

echo
echo "── Not digest-comparable (manual check) ──────────────────────────"
for row in "${UNCOMPARABLE[@]}"; do
  IFS='|' read -r ref role why <<<"$row"
  printf "  ~  %-34s %s — %s\n" "$ref" "$role" "$why"
done
echo "  Auth SMTP smtp_pass  vs  edge RESEND_API_KEY  — different endpoints;"
echo "  verify by: printf '%s' '<working resend key>' | sha256sum  =="
echo "             $(digest_of edge RESEND_API_KEY)"
echo

# ── REPORTER: write findings, resolve anything that has cleared ──────────────────────
#
# NEVER FAILS ON A FINDING. Findings reach a human through the daily monitor email, which
# is already read and already carries conditional sections.
sql_lit() { printf "%s" "$1" | sed "s/'/''/g"; }

if (( ${#FINDINGS[@]} )); then
  keys=""
  for f in "${FINDINGS[@]}"; do
    key="${f%%$'\t'*}"; summary="${f#*$'\t'}"
    keys="${keys}${keys:+,}'$(sql_lit "$key")'"
    run_sql "INSERT INTO public.standing_check_findings (check_name, finding_key, summary, status)
             VALUES ('$(sql_lit "$CHECK_NAME")','$(sql_lit "$key")','$(sql_lit "$summary")','open')
             ON CONFLICT (check_name, finding_key) DO UPDATE SET
               last_seen = now(),
               report_count = public.standing_check_findings.report_count + 1,
               summary = EXCLUDED.summary,
               status = 'open', resolved_at = NULL;" > /dev/null
  done
  # Anything previously open and no longer reported has cleared.
  run_sql "UPDATE public.standing_check_findings SET status='resolved', resolved_at=now()
           WHERE check_name='$(sql_lit "$CHECK_NAME")' AND status='open'
             AND finding_key NOT IN (${keys});" > /dev/null
else
  run_sql "UPDATE public.standing_check_findings SET status='resolved', resolved_at=now()
           WHERE check_name='$(sql_lit "$CHECK_NAME")' AND status='open';" > /dev/null
fi

echo
echo "── Reporter ──────────────────────────────────────────────────────"
# THE ESCALATION RULE LIVES IN public.fmb_escalated_findings, NOT HERE. This query used to be
# inline and did not mention `kind`, so a coverage row -- specified as unable to escalate --
# would have counted toward the threshold the moment anything incremented it. One check with the
# rule inline is one check's worth of correctness; a function is every check's.
ESCALATED="$(run_sql "SELECT finding_key, report_count FROM public.fmb_escalated_findings('$(sql_lit "$CHECK_NAME")', ${ESCALATION_REPORTS});" \
             | jq -r '.[]? | "\(.finding_key) (reported \(.report_count)x)"')"
OPEN_N="$(run_sql "SELECT count(*) AS n FROM public.standing_check_findings
                   WHERE check_name='$(sql_lit "$CHECK_NAME")' AND status='open';" | jq -r '.[0].n // 0')"

# ASSERTED, NOT OMITTED. An absent line would mean nobody asked.
echo "  open findings: ${OPEN_N}"

if [[ -n "$ESCALATED" ]]; then
  echo
  echo "  ESCALATED — reported ${ESCALATION_REPORTS}+ times and still open:"
  printf '    %s\n' $ESCALATED
  echo
  echo "RESULT: ESCALATED. This red does NOT mean the finding is severe."
  echo "        IT MEANS THE REPORTING CHANNEL IS NOT WORKING: this was reported"
  echo "        ${ESCALATION_REPORTS} times and nothing changed. Act on the finding, or record a"
  echo "        deliberate decision not to, which resolves it."
  exit 1
fi

if (( DIVERGENCE )); then
  echo "RESULT: ${OPEN_N} finding(s) recorded for the monitor email. NOT a CI failure —"
  echo "        a finding is not a broken check. Red here means cannot-run or escalated."
  exit 0
fi
echo "RESULT: no divergence detected."
