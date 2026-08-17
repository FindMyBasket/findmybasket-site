#!/usr/bin/env bash
# Assert the work-list's item numbers are contiguous and unique.
#
# CATCHES TWO FAILURES THAT LOOK IDENTICAL FROM INSIDE THE FILE AND ARE INVISIBLE WITHOUT
# LISTING THE HEADINGS:
#
#   A GAP    -- an item written on a branch that never merged. Items 153-157 were out of
#               main for a full day on 17 August; the sequence read 152, 158, nothing
#               collided, and no diff showed it because a diff shows what changed rather
#               than what is absent.
#   A DUP    -- the same number used twice, which is what a hollow or re-used number looks
#               like once two branches allocate in parallel.
#
# A gap is the harder of the two: a duplicate is at least PRESENT and greppable. An absence
# has no line to find.
set -euo pipefail
F="${1:-docs/post-4-august-work-list.md}"
nums=$(grep -oE '^### [0-9]+\.' "$F" | grep -oE '[0-9]+')
[ -n "$nums" ] || { echo "no numbered headings found in $F"; exit 1; }

dups=$(echo "$nums" | sort -n | uniq -d)
if [ -n "$dups" ]; then echo "DUPLICATE item numbers: $(echo $dups | tr '\n' ' ')"; fi

first=$(echo "$nums" | sort -n | head -1)
last=$(echo "$nums" | sort -n | tail -1)
missing=$(comm -13 <(echo "$nums" | sort -n | uniq) <(seq "$first" "$last"))
if [ -n "$missing" ]; then echo "MISSING item numbers: $(echo $missing | tr '\n' ' ')"; fi

if [ -n "$dups" ] || [ -n "$missing" ]; then exit 1; fi
echo "contiguous: $(echo "$nums" | wc -l | tr -d ' ') items, $first..$last, no gaps, no duplicates"
