-- Phase 2A: Proposal-centric pivot — architecture prep for post-acceptance
-- project creation (section 40 of the brief). NOT exposed in the UI: no
-- route or button calls this. It is unreachable in ordinary use because
-- proposals.status can never actually become 'accepted' in Phase 2A (no
-- function sets it — see docs/31-proposal-state-machines.md) — granted to
-- authenticated anyway since the precondition check makes that safe, same
-- reasoning as create_new_proposal_version(). Tested via a controlled test
-- preparation (service_role directly sets status='accepted'), never via a
-- faked UI acceptance flow — see docs/adr/0034-project-creation-after-acceptance.md.

create or replace function public.create_project_from_accepted_proposal(p_proposal_id uuid)
returns public.projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_proposal public.proposals;
  v_existing public.projects;
  v_project public.projects;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_proposal from public.proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_proposal.tenant_id, 'projects.create') then
    raise exception 'Missing permission: projects.create' using errcode = '42501';
  end if;

  if v_proposal.status <> 'accepted' then
    raise exception 'Only an accepted proposal can be converted to a project' using errcode = '22023';
  end if;

  -- Idempotent: a proposal's opportunity can have at most one project
  -- (existing projects_opportunity_id_key unique index from Phase 1) — if
  -- one already exists, return it rather than erroring or duplicating.
  if v_proposal.opportunity_id is not null then
    select * into v_existing from public.projects where opportunity_id = v_proposal.opportunity_id;
    if found then
      return v_existing;
    end if;
  end if;

  insert into public.projects (
    tenant_id, client_id, opportunity_id, primary_contact_id, name, service_type, created_by
  )
  values (
    v_proposal.tenant_id, v_proposal.client_id, v_proposal.opportunity_id, v_proposal.client_contact_id,
    v_proposal.title, v_proposal.service_type, v_user_id
  )
  returning * into v_project;

  perform public.log_audit_event(v_proposal.tenant_id, v_user_id, 'project.created', 'project', v_project.id,
    jsonb_build_object('from_accepted_proposal', p_proposal_id));
  perform public.log_crm_activity(v_proposal.tenant_id, v_proposal.client_id, v_proposal.opportunity_id, v_project.id,
    'project_created', v_user_id, jsonb_build_object('from_accepted_proposal', true));

  return v_project;
end;
$$;

comment on function public.create_project_from_accepted_proposal(uuid) is
  'Architecture prep for the Client Portal phase — not exposed in Phase 2A UI, unreachable in ordinary use since no proposal can reach status=accepted yet. See docs/adr/0034-project-creation-after-acceptance.md.';

revoke execute on function public.create_project_from_accepted_proposal(uuid) from public;
grant execute on function public.create_project_from_accepted_proposal(uuid) to authenticated;
