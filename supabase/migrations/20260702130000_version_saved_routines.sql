-- Version the saved_routines feature (table + indexes + RLS + welcome-email
-- trigger) that until now existed ONLY in production and was never in a
-- migration — which is precisely why the save bug was invisible: there was no
-- source of truth to review.
--
-- This migration captures the SAFE, minimal state:
--   * RLS enabled;
--   * INSERT policy for anon/authenticated (existing) — anyone may save;
--   * NO SELECT policy  -> the anon key can never read stored emails/routines;
--   * NO UPDATE/DELETE policy -> anon cannot rewrite or delete rows directly.
--
-- The actual save write (which must upsert-by-email, and therefore must read the
-- conflicting row — something anon cannot be allowed to do without exposing the
-- whole table) is handled by the SECURITY DEFINER function fmb_save_routine in
-- the companion migration 20260702130500_fmb_save_routine_rpc.sql. That keeps the
-- table fully locked to anon while still letting the save flow work.
--
-- Idempotent: IF NOT EXISTS / OR REPLACE / drop-then-create, so it is a no-op
-- against the existing prod table and reproduces the feature in a fresh env.

create table if not exists public.saved_routines (
  id                bigserial primary key,
  email             text        not null,
  routine           jsonb       not null,
  created_at        timestamptz default now(),
  last_emailed_at   timestamptz,
  unsubscribe_token text        not null default gen_random_uuid()::text,
  active            boolean     default true
);

-- Unique email is what makes the save RPC's ON CONFLICT (email) upsert work.
create unique index if not exists saved_routines_email_unique          on public.saved_routines (email);
create unique index if not exists saved_routines_unsubscribe_token_key on public.saved_routines (unsubscribe_token);
create index        if not exists idx_saved_routines_active            on public.saved_routines (active) where active = true;

-- Direct table grants for anon: INSERT only (used by the existing INSERT policy).
-- No SELECT/UPDATE/DELETE needed by the client — the RPC (SECURITY DEFINER) does
-- the writes. RLS still governs everything below.
grant insert on public.saved_routines to anon, authenticated;

alter table public.saved_routines enable row level security;

-- INSERT: anyone may save a routine (existing policy, re-declared for versioning).
drop policy if exists "Anyone can save a routine" on public.saved_routines;
create policy "Anyone can save a routine"
  on public.saved_routines for insert
  to anon, authenticated
  with check (true);

-- Deliberately NO SELECT, UPDATE, or DELETE policy. See header + the RPC migration.

-- Welcome-email trigger: on insert, fire the send-routine-email edge function in
-- welcome mode. SECURITY DEFINER so it can read the service key from vault.
-- net.http_post is async and never aborts the insert. (Re-declared for versioning.)
create or replace function public.trigger_welcome_email()
returns trigger
language plpgsql
security definer
as $function$
declare
  service_key text;
begin
  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;

  perform net.http_post(
    url := 'https://crtrjoescntlcjiwdtrt.supabase.co/functions/v1/send-routine-email?mode=welcome&routineId=' || new.id::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    )
  );
  return new;
end;
$function$;

drop trigger if exists send_welcome_email_trigger on public.saved_routines;
create trigger send_welcome_email_trigger
  after insert on public.saved_routines
  for each row execute function public.trigger_welcome_email();
