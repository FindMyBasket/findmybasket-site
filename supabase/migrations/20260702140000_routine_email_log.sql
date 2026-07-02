-- Delivery observability for send-routine-email: one row per send attempt, so a
-- delivery problem is discoverable by query instead of by accident.
--
-- Written only by the edge function via the SERVICE ROLE (which bypasses RLS).
-- RLS is enabled with NO anon/authenticated policies, so the public anon key can
-- neither read nor write it (it holds emails).
--
-- Columns:
--   ok                 = whether Resend returned 2xx for this attempt
--   resend_message_id  = Resend's message id (on success) for later correlation
--                        with delivery/bounce webhooks
--   error              = Resend status+body, or the thrown error, on failure

create table if not exists public.routine_email_log (
  id                 bigserial primary key,
  routine_id         bigint,
  email              text,
  mode               text,
  ok                 boolean     not null,
  resend_message_id  text,
  error              text,
  created_at         timestamptz not null default now()
);

create index if not exists idx_routine_email_log_routine  on public.routine_email_log (routine_id, created_at desc);
create index if not exists idx_routine_email_log_failures on public.routine_email_log (created_at desc) where ok = false;

alter table public.routine_email_log enable row level security;
-- No policies: only the service role (RLS-exempt) reads/writes this table.
