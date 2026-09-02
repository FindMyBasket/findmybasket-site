#!/usr/bin/env bash
# Assert the banned discount word does not appear in user-facing strings.
#
# THE RULE IS docs/editorial-register.md RULE 2. The words are "cheapest" and "cheaper"; the forms
# are "best value", "best price" and "costs less". This script names the word because the
# statement in the PDF spec did not, and the statement that DID name them sat in an article
# template's header comment. Two statements, different content, neither a home: only the
# template mentioned "cheaper" at all. Work-list items 562 and 563.
#
# WHY A STRING SWEEP IS CORRECT HERE, against convention 12. That convention warns that a
# string-scoped sweep misses paraphrases, and it is right about every other register rule.
# A BANNED WORD IS THE ONE CASE WHERE STRING-SCOPING IS EXACTLY THE RULE, because the rule
# is about a literal token rather than about a meaning.
#
# THE DISCRIMINATOR IS TWO CONDITIONS AND IT IS ENOUGH. The word must sit inside a quote,
# and the line must not be a comment. Measured 2 September 2026 against a file containing
# eight comment and identifier uses alongside the two real ones: zero false positives.
#
# WHAT IT CANNOT DO, so green is not read as clean:
#   1. It catches the word, not the intent. "lowest price" passes.
#   2. It reaches only the repository. Copy written in a document, a CMS or a PDF template
#      is outside it, WHICH IS WHERE THE RULE WAS BORN. This covers the surface that
#      shipped the violation, not the surface the rule was written for.
set -uo pipefail

WORDS='cheapest|cheaper'
PATTERN="['\"\`][^'\"\`]*\\b(${WORDS})\\b"

# docs/ and __tests__ are excluded: docs/article-template.html STATES the rule and would
# flag itself, and a test title naming the house rule is not output. Excluding the rule's
# own statement is the mirror of the check-worklist-citations problem, where a file scanned
# by itself flags its own illustrative example.
files=$(git ls-files | grep -E '\.(tsx|ts|jsx|js|html)$' | grep -vE '^(scripts|supabase|docs)/|__tests__' || true)
[ -n "$files" ] || { echo "no candidate files found"; exit 1; }

hits=$(printf '%s\n' "$files" \
  | xargs grep -niE "$PATTERN" 2>/dev/null \
  | grep -vE ':[0-9]+:[[:space:]]*(//|\*|/\*)' || true)

if [ -n "$hits" ]; then
  echo "BANNED WORD in user-facing strings (docs/editorial-register.md rule 2):"
  echo "$hits"
  echo
  echo "Permitted forms: best value, best price, costs less."
  exit 1
fi

echo "banned-word check: clean across $(printf '%s\n' "$files" | wc -l | tr -d ' ') files"
