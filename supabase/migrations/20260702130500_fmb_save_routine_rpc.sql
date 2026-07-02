-- Save-routine write path: a SECURITY DEFINER RPC the client calls instead of
-- writing saved_routines directly.
--
-- Why an RPC and not a client-side upsert:
--   * The save is an upsert keyed on email. INSERT ... ON CONFLICT DO UPDATE must
--     READ the conflicting row, and a plain UPDATE ... WHERE email = $1 must read
--     the email column — both require a SELECT policy. For an unauthenticated
--     anon caller a SELECT policy can only be USING(true), which would expose
--     every stored email + routine. An anon UPDATE policy is worse: USING(true)
--     lets any caller run "UPDATE saved_routines SET ..." with no WHERE and
--     rewrite every row.
--   * Running the upsert inside a SECURITY DEFINER function (as the owner) bypasses
--     RLS for this one controlled operation, so the table stays fully unreadable
--     and un-writable by anon directly, while the save still works.
--
-- Loud failure: returns the saved row id. The caller treats a null id (or a
-- thrown error) as failure and never shows success without one. Invalid input
-- raises, surfacing as an error to the client.
--
-- set search_path = '' + fully schema-qualified names: standard hardening for a
-- SECURITY DEFINER function so it cannot be hijacked via a mutable search_path.

create or replace function public.fmb_save_routine(p_email text, p_routine jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id    bigint;
begin
  if v_email = '' or position('@' in v_email) = 0 or position('.' in v_email) = 0 then
    raise exception 'invalid email';
  end if;
  if p_routine is null
     or jsonb_typeof(p_routine) <> 'array'
     or jsonb_array_length(p_routine) = 0 then
    raise exception 'empty routine';
  end if;

  insert into public.saved_routines (email, routine, last_emailed_at, active)
  values (v_email, p_routine, null, true)
  on conflict (email) do update
    set routine         = excluded.routine,
        last_emailed_at  = null,
        active           = true
  returning id into v_id;

  return v_id;
end;
$$;

-- Only the RPC is exposed to anon; the table itself stays locked.
revoke all on function public.fmb_save_routine(text, jsonb) from public;
grant execute on function public.fmb_save_routine(text, jsonb) to anon, authenticated;
