-- Continuation of the same user-deletion fix. `proposal_measurement_groups`
-- is the only table protected by prevent_locked_version_child_mutation()
-- (Phase 2A/3B.1) that references auth.users at all (`created_by`, made
-- ON DELETE SET NULL in 20260724100200) -- but the trigger unconditionally
-- rejects EVERY mutation to a locked/superseded version's children, with no
-- column-level exception. That's asymmetric with its sibling function,
-- prevent_locked_proposal_version_mutation(), which already excludes
-- created_by from its protected-columns allowlist for exactly this reason.
--
-- Narrow fix, matching that same precedent: allow an UPDATE on
-- proposal_measurement_groups ONLY when it is exactly the SET NULL cascade
-- shape (created_by non-null -> null, nothing else changed). Every other
-- table, and every other kind of mutation (including DELETE) on a
-- locked/superseded version's children, remains fully blocked -- version
-- content immutability is unaffected.

create or replace function public.prevent_locked_version_child_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_version_id uuid;
  v_status text;
begin
  if tg_op = 'DELETE' then
    v_version_id := old.proposal_version_id;
  else
    v_version_id := new.proposal_version_id;
  end if;

  select version_status into v_status from public.proposal_versions where id = v_version_id;
  if v_status in ('locked', 'superseded') then
    if tg_op = 'UPDATE'
       and tg_table_name = 'proposal_measurement_groups'
       and old.created_by is not null
       and new.created_by is null
       and to_jsonb(new) - 'created_by' = to_jsonb(old) - 'created_by'
    then
      return new;
    end if;
    raise exception 'Cannot modify children of a locked or superseded proposal version' using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
