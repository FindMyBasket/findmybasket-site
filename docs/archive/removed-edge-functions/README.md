# Removed edge functions (archive — not deployed, not deployable)

These three AWIN diagnostic functions were **deleted from the Supabase project on
2026-07-21**. They are kept here only so the deletion is reversible. They live
outside `supabase/functions/` deliberately: anything under that directory is a
redeploy candidate, and these must not come back as-is.

## Why they were removed

They were **deployed orphans** — live on the project, but with no source under
version control and no caller anywhere (no app code invokes `functions/v1` at
all; the only repo mentions were comments).

Two of them leaked `AWIN_API_KEY` in their response body, to any caller holding
the **public** anon key:

| function | leaked the key | how |
| --- | --- | --- |
| `awin-find-our-feeds` | yes | returned `download_url` with `apikey/<KEY>` inline |
| `awin-list-feeds` | yes | returned the raw AWIN feed-list CSV, whose `URL` column embeds the key |
| `awin-inspect-feed` | no | removed as dead code, not as a leak |

AWIN provide **no key rotation on this account**, so containing the leak was the
entire fix — hence deletion rather than patching.

## If you ever need this capability again

Do not redeploy these files as-is. Rebuild against two rules:

1. **Never return a key-bearing value.** Return feed metadata only (feed id,
   name, product count, dates). Build the download URL server-side at fetch
   time from the env var; it must never appear in a response body.
2. **Gate on an in-function role check.** `verify_jwt = true` does *not* keep the
   public out — the anon key is a valid JWT and passes the gate. Compare the
   bearer against `SUPABASE_SERVICE_ROLE_KEY`, or verify the JWT `role` claim.

The surviving `supabase/functions/awin-feed-count` is the pattern worth copying
for rule 1: it builds the AWIN URL internally and returns counts only.

The sources here are clean — all three read `AWIN_API_KEY` from `Deno.env`,
none hardcode it. That was verified before archiving.
