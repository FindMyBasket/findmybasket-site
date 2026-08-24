#!/usr/bin/env bash
# Assert that every work-list item cited in the repository actually exists.
#
# WHY THIS EXISTS. On 24 August 2026, PR #410 shipped `products_servable` with comments
# citing "item 263". THE ITEM DID NOT EXIST -- the PR carried the code and not the record.
# It was caught by accident: the contiguity check refused item 264 because 263 was missing
# from the sequence. Nothing was checking that a CITED item resolves.
#
# WHY A DANGLING CITATION IS WORSE THAN A WRONG NUMBER. A wrong figure is one wrong fact and
# the next measurement corrects it. AN ITEM REFERENCE IS THE MECHANISM THIS REPOSITORY USES
# TO CARRY REASONING FORWARD: code cites items, items cite each other, and a decision made in
# August is reachable in December only because the citations hold. A dangling one degrades
# the instrument rather than one comment -- it makes every other citation slightly less worth
# following, because the reader now knows they sometimes go nowhere.
#
# ── WHAT THIS CANNOT CHECK, STATED SO NOBODY MISTAKES GREEN FOR CORRECT ──────────────────
#
# A CITATION CAN RESOLVE AND STILL BE WRONG ABOUT WHAT IT RESOLVES TO. If item 200 is edited
# so that it no longer says what a comment citing it claims, this check passes and the
# comment is now false. Renumbering has the same effect: the number is valid, the content
# behind it is somebody else's. Only a person reading both can catch that, and this script
# should never be described as verifying citations -- it verifies that their TARGETS EXIST.
#
# ── CASE-INSENSITIVE, AND THAT WAS NOT TRUE FOR THE FIRST DAY. ──────────────────────────
#
# The first version used `grep -hoE`, not `-hoiE`. THE DOMINANT CITATION FORM IN THIS
# REPOSITORY IS A CAPITALISED "Item 271." at the end of a comment, and the check could not see
# a single one of them -- 14 distinct items invisible, and on 24 August it passed a PR that
# shipped four citations of an item that did not exist. The defect it was built to catch,
# missed by the check built to catch it, one day later.
#
# WORSE: THE NEGATIVE TEST DID NOT CATCH IT EITHER, because it was written in the lowercase
# form. THE GUARD WAS TESTED WITH AN INPUT SHAPED LIKE THE ONES IT COULD ALREADY SEE. A
# negative test that shares a blind spot with the thing it tests proves only that the blind
# spot is consistent. Both forms are now exercised -- see the run instructions above.
#
# (This comment deliberately contains no worked example of a citation, because THIS FILE IS
# SCANNED BY ITSELF: an illustrative reference here would be indistinguishable from a real
# one, and the first draft of this note flagged its own prose.)
#
# Also unchecked: LINE references. `work-list line 1479` appears once (in
# 20260813200000_capture_products_active.sql) and is CURRENTLY CORRECT -- but only because
# this list is append-only. Any insertion above that line breaks it silently and no check
# here or elsewhere would notice. Prefer item numbers; they survive edits.
# NOTE ON THE EXTRACTION BELOW: it uses `grep -hoE`, NOT `-honE`. The first draft included
# -n, which prepends the LINE NUMBER to each match; the digit extraction then read those line
# numbers as item ids and reported 63 dangling citations that did not exist. A check that
# invents its own failures is the same defect class as one that reports success while broken
# -- both make the output uninformative -- and it was caught only by tracing one bogus id back
# to `1247:items 71, 72, 79`. Do not add -n here. Item 265.
set -euo pipefail
LIST="${1:-docs/post-4-august-work-list.md}"
[ -f "$LIST" ] || { echo "work list not found: $LIST"; exit 1; }

exists=$(mktemp); trap 'rm -f "$exists"' EXIT
grep -oE '^### [0-9]+\.' "$LIST" | grep -oE '[0-9]+' | sort -n -u > "$exists"

# Every "item N" / "items N, M and P" in tracked source and docs, excluding the list itself.
cites=$(git ls-files \
  | grep -E '\.(ts|tsx|mts|mjs|js|sql|md|ya?ml|sh)$' \
  | grep -v -F "$LIST" \
  | xargs grep -hoiE '\bitems?[[:space:]]+[0-9]+([[:space:]]*(,|and|to|-|&)[[:space:]]*[0-9]+)*' 2>/dev/null \
  | grep -oE '[0-9]+' | sort -n -u || true)

dangling=""
for n in $cites; do
  # NO UPPER BOUND. The first draft skipped anything above 5000 as "implausible", which
  # silently ignored exactly the case this exists to catch -- a negative test citing item
  # 9999 PASSED. A guard that suppresses the failure mode it was written beside is worse
  # than no guard. Item 265.
  [ "$n" -ge 1 ] || continue
  grep -qx "$n" "$exists" || dangling="$dangling $n"
done

if [ -n "$dangling" ]; then
  echo "DANGLING item citations -- cited in the repository, absent from the work list:$dangling"
  for n in $dangling; do
    echo "  item $n cited at:"
    git ls-files | grep -E '\.(ts|tsx|mts|mjs|js|sql|md|ya?ml|sh)$' | grep -v -F "$LIST" \
      | xargs grep -niE "\bitems?[[:space:]]+([0-9]+[[:space:]]*(,|and|to|-|&)[[:space:]]*)*$n\b" 2>/dev/null \
      | sed 's/^/    /' | head -5
  done
  exit 1
fi

echo "citations resolve: $(echo "$cites" | wc -w | tr -d ' ') distinct items cited, all present in $LIST"
echo "  (target existence only -- a citation can resolve and still misdescribe what it points at)"
