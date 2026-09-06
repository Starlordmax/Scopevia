-- Fix a real bug in 20260724100400: `old.created_by` / `new.created_by`
-- are STATIC field references on OLD/NEW's row type. prevent_locked_version_
-- child_mutation() is a single generic function shared by every version-
-- child table (proposal_sections, proposal_labor_items, proposal_line_items,
-- proposal_media, and all four measurement tables) -- none of which except
-- proposal_measurement_groups even HAS a created_by column. PL/pgSQL must
-- resolve every column reference in an expression against the row type
-- before it can short-circuit on tg_table_name, so firing this trigger on
-- ANY other table raised `42703: column "created_by" does not exist`
-- instead of the intended `55000` immutability error. The mutation was
-- still blocked either way (any exception aborts the transaction, so
-- nothing was ever bypassed) -- but with the wrong, confusing error code.
-- Found by tests/rls/phase3b1-proposal-revision.test.ts.
--
-- Fixed by using to_jsonb()/->>/-  (jsonb operators, valid for any row
-- type) instead of a typed field reference, so the expression never fails
-- to parse regardless of which table's OLD/NEW it runs against.

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
       and (to_jsonb(old) ->> 'created_by') is not null
       and (to_jsonb(new) ->> 'created_by') is null
       and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by')
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
