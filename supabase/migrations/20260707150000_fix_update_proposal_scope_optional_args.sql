-- Fix update_proposal_scope: PostgREST resolves an RPC call to a specific
-- function overload based on exactly which argument names are present in
-- the request body. The original signature had no SQL DEFAULT on any of
-- its four optional fields, so a request that omitted one (because the
-- corresponding value was JSON-encoded as `undefined`, which
-- JSON.stringify drops entirely) looked like a call to a different,
-- nonexistent overload and failed with "Could not find the function ... in
-- the schema cache" -- even though the function itself existed and was
-- reachable when all five arguments were supplied.
--
-- The fix is twofold (this migration covers the SQL half; the other half
-- is the application layer now always sending every optional key
-- explicitly as `null`, never omitting it): give every optional parameter
-- a SQL DEFAULT NULL, so PostgREST can still resolve the 5-argument
-- overload even if a future caller omits a key, and Postgres itself
-- accepts NULL for any of them exactly as before.
--
-- Only defaults are added; parameter names, order, and types are
-- unchanged, so CREATE OR REPLACE FUNCTION applies to the existing
-- function (same OID) without needing to drop and recreate it -- grants
-- and dependents are preserved automatically. They are reapplied below
-- anyway, to leave no doubt about the resulting privileges.
create or replace function public.update_proposal_scope(
  p_proposal_version_id uuid,
  p_summary text default null,
  p_scope_intro text default null,
  p_estimated_start_date date default null,
  p_estimated_duration_days int default null
)
returns public.proposal_versions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_version public.proposal_versions;
  v_result public.proposal_versions;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_version from public.proposal_versions where id = p_proposal_version_id;
  if not found then
    raise exception 'Proposal version not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_version.tenant_id, 'proposals.update') then
    raise exception 'Missing permission: proposals.update' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  if p_estimated_duration_days is not null and p_estimated_duration_days <= 0 then
    raise exception 'Estimated duration must be greater than zero' using errcode = '22023';
  end if;

  update public.proposal_versions
     set summary = p_summary, scope_intro = p_scope_intro,
         estimated_start_date = p_estimated_start_date, estimated_duration_days = p_estimated_duration_days
   where id = p_proposal_version_id
   returning * into v_result;

  perform public.log_audit_event(v_version.tenant_id, v_user_id, 'proposal.updated', 'proposal_version', p_proposal_version_id, '{}'::jsonb);

  return v_result;
end;
$$;

revoke execute on function public.update_proposal_scope(uuid, text, text, date, int) from public;
revoke execute on function public.update_proposal_scope(uuid, text, text, date, int) from anon;
grant execute on function public.update_proposal_scope(uuid, text, text, date, int) to authenticated;

-- Ask PostgREST to refresh its schema cache immediately rather than
-- waiting for its next poll interval. This is a courtesy, not a
-- dependency: the application-layer fix ensures every optional argument
-- is always sent explicitly (as null when empty), so the call resolves
-- correctly against the existing schema cache regardless of whether this
-- notification is received.
notify pgrst, 'reload schema';
