-- Phase 1: CRM & Projects — shared helpers
--
-- log_crm_activity() is the sole write path into crm_activities, mirroring
-- log_audit_event()'s role for audit_logs. It is never granted to
-- `authenticated` directly — only the CRM mutation functions below call it
-- (as the function owner, since they are all SECURITY DEFINER), the same way
-- create_tenant_with_owner() calls log_audit_event() without needing its own
-- separate grant.

create or replace function public.log_crm_activity(
  p_tenant_id uuid,
  p_client_id uuid,
  p_opportunity_id uuid,
  p_project_id uuid,
  p_activity_type text,
  p_actor_user_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_actor_user_id is not null and p_actor_user_id <> auth.uid() then
    raise exception 'Cannot log a CRM activity on behalf of another user' using errcode = '42501';
  end if;

  insert into public.crm_activities (tenant_id, client_id, opportunity_id, project_id, activity_type, actor_user_id, metadata)
  values (p_tenant_id, p_client_id, p_opportunity_id, p_project_id, p_activity_type, p_actor_user_id, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.log_crm_activity(uuid, uuid, uuid, uuid, text, uuid, jsonb) is
  'The only sanctioned way to write to crm_activities. Called internally by CRM mutation functions within the same transaction as the mutation itself (transactional_required, same discipline as log_audit_event()). Never exposed to `authenticated` directly — see grants below.';

revoke execute on function public.log_crm_activity(uuid, uuid, uuid, uuid, text, uuid, jsonb) from public, anon, authenticated;

-- =============================================================================
-- Shared validation used by every "assignee" parameter (opportunities.assigned_to,
-- projects.assigned_to): the assignee must be an ACTIVE member of the same tenant.
-- A suspended/removed member can remain assigned to existing records (see
-- docs/20-phase-1-crm-and-projects.md, "Assignees") but cannot be newly assigned.
-- =============================================================================

create or replace function public.is_active_member_of_tenant(p_membership_id uuid, p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tenant_memberships tm
    where tm.id = p_membership_id
      and tm.tenant_id = p_tenant_id
      and tm.status = 'active'
  );
$$;

comment on function public.is_active_member_of_tenant(uuid, uuid) is
  'True if p_membership_id is an ACTIVE membership of p_tenant_id. Used to validate a new assignee at the moment of assignment — does not retroactively unassign someone who is later suspended.';

revoke execute on function public.is_active_member_of_tenant(uuid, uuid) from public;
grant execute on function public.is_active_member_of_tenant(uuid, uuid) to authenticated;
