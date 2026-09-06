-- Phase 2A: Proposal-centric pivot — core proposal lifecycle functions.
--
-- Decision (docs/adr/0026-opportunity-auto-creation.md): create_proposal_direct
-- ALWAYS ends up with an opportunity attached — either the one passed in
-- (validated to belong to the same client) or a lightweight one created
-- automatically in the same transaction, in status 'proposal_in_progress'.
-- This keeps the pipeline/dashboard consistent (every proposal is
-- discoverable from an opportunity) without forcing the user through a
-- separate "create opportunity" step first, per section 20 of the brief.

-- Lightweight idempotency guard against double-submit — see docs/32 (no,
-- see docs/30-phase-2a-proposal-data-model.md) for why a full distributed
-- idempotency system is out of scope: a per-tenant unique (idempotency_key)
-- row reserved before the real work, so a retried/duplicated request either
-- finds the already-created proposal or is told one is already in flight.
create table public.proposal_creation_requests (
  tenant_id uuid not null references public.tenants (id),
  idempotency_key text not null,
  proposal_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, idempotency_key)
);

comment on table public.proposal_creation_requests is
  'Idempotency guard for create_proposal_direct()/create_proposal_from_opportunity() — see docs/adr/0026-opportunity-auto-creation.md.';

create or replace function public.create_initial_proposal_version(p_tenant_id uuid, p_proposal_id uuid, p_actor uuid)
returns public.proposal_versions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings public.tenant_proposal_settings;
  v_version public.proposal_versions;
begin
  v_settings := public.ensure_tenant_proposal_settings(p_tenant_id);

  insert into public.proposal_versions (
    tenant_id, proposal_id, version_number, version_status,
    default_hours_per_day, terms, exclusions, tax_rate_bps, created_by
  )
  values (
    p_tenant_id, p_proposal_id, 1, 'draft',
    v_settings.default_hours_per_day, v_settings.default_terms, v_settings.default_exclusions,
    v_settings.default_tax_rate_bps, p_actor
  )
  returning * into v_version;

  update public.proposals set current_version_id = v_version.id where id = p_proposal_id;

  perform public.recalculate_proposal_version(v_version.id);
  select * into v_version from public.proposal_versions where id = v_version.id;
  return v_version;
end;
$$;

comment on function public.create_initial_proposal_version(uuid, uuid, uuid) is
  'Creates version 1 (draft) for a brand-new proposal, seeded from the tenant''s default settings. Internal only — called by create_proposal_direct()/create_proposal_from_opportunity().';

-- If the opportunity is in a state the proposal flow can legally move
-- forward from, sync it to proposal_in_progress. If it's already terminal
-- (won/lost/archived) or already further along, leave it untouched rather
-- than force an invalid/undesirable transition — the proposal is still
-- created and linked either way.
create or replace function public.sync_opportunity_to_proposal_in_progress(p_opportunity_id uuid, p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  select status into v_status from public.opportunities where id = p_opportunity_id and tenant_id = p_tenant_id;
  if v_status in ('qualified', 'inspection_scheduled', 'ready_for_estimate') then
    update public.opportunities set status = 'proposal_in_progress' where id = p_opportunity_id;
  elsif v_status in ('new', 'contacted') then
    -- Skip straight past 'qualified' — creating a proposal is itself strong
    -- evidence of qualification. Same reasoning as above: don't block
    -- proposal creation on a separate manual pipeline step.
    update public.opportunities set status = 'proposal_in_progress' where id = p_opportunity_id;
  end if;
  -- won/lost/archived/proposal_in_progress: no-op, left untouched.
end;
$$;

comment on function public.sync_opportunity_to_proposal_in_progress(uuid, uuid) is
  'Best-effort sync of an opportunity to proposal_in_progress when a proposal is created for/from it. Never raises on an opportunity already past that point — see docs/31-proposal-state-machines.md, "Sincronización conceptual."';

create or replace function public.create_proposal_direct(
  p_tenant_id uuid,
  p_client_id uuid,
  p_title text,
  p_service_type text,
  p_client_contact_id uuid default null,
  p_opportunity_id uuid default null,
  p_idempotency_key text default null
)
returns public.proposals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_client public.clients;
  v_opportunity public.opportunities;
  v_proposal public.proposals;
  v_existing_proposal_id uuid;
  v_number int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.user_has_permission(p_tenant_id, 'proposals.create') then
    raise exception 'Missing permission: proposals.create' using errcode = '42501';
  end if;

  if p_idempotency_key is not null then
    begin
      insert into public.proposal_creation_requests (tenant_id, idempotency_key) values (p_tenant_id, p_idempotency_key);
    exception when unique_violation then
      select proposal_id into v_existing_proposal_id
        from public.proposal_creation_requests
       where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
      if v_existing_proposal_id is not null then
        select * into v_proposal from public.proposals where id = v_existing_proposal_id;
        return v_proposal;
      end if;
      raise exception 'This proposal is already being created — please wait a moment and refresh' using errcode = '55000';
    end;
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'Title is required' using errcode = '22023';
  end if;

  select * into v_client from public.clients where id = p_client_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Client not found in this tenant' using errcode = 'P0002';
  end if;

  if p_client_contact_id is not null then
    if not exists (select 1 from public.client_contacts where id = p_client_contact_id and tenant_id = p_tenant_id and client_id = p_client_id) then
      raise exception 'Contact does not belong to the selected client' using errcode = '22023';
    end if;
  end if;

  if p_opportunity_id is not null then
    select * into v_opportunity from public.opportunities where id = p_opportunity_id and tenant_id = p_tenant_id;
    if not found then
      raise exception 'Opportunity not found in this tenant' using errcode = 'P0002';
    end if;
    if v_opportunity.client_id <> p_client_id then
      raise exception 'Opportunity belongs to a different client' using errcode = '22023';
    end if;
  else
    -- Auto-create a lightweight opportunity — see migration header and
    -- docs/adr/0026-opportunity-auto-creation.md.
    insert into public.opportunities (tenant_id, client_id, title, status, created_by)
    values (p_tenant_id, p_client_id, btrim(p_title), 'proposal_in_progress', v_user_id)
    returning * into v_opportunity;
    perform public.log_audit_event(p_tenant_id, v_user_id, 'opportunity.created', 'opportunity', v_opportunity.id,
      jsonb_build_object('title', v_opportunity.title, 'auto_created_for_proposal', true));
    perform public.log_crm_activity(p_tenant_id, p_client_id, v_opportunity.id, null, 'opportunity_created', v_user_id,
      jsonb_build_object('title', v_opportunity.title, 'auto_created_for_proposal', true));
  end if;

  if exists (
    select 1 from public.proposals where opportunity_id = v_opportunity.id and archived_at is null
  ) then
    raise exception 'This opportunity already has an active proposal' using errcode = '55000';
  end if;

  v_number := public.allocate_next_proposal_number(p_tenant_id);

  insert into public.proposals (
    tenant_id, proposal_number, client_id, client_contact_id, opportunity_id,
    title, service_type, source, created_by
  )
  values (
    p_tenant_id, v_number, p_client_id, p_client_contact_id, v_opportunity.id,
    btrim(p_title), p_service_type, 'direct', v_user_id
  )
  returning * into v_proposal;

  perform public.create_initial_proposal_version(p_tenant_id, v_proposal.id, v_user_id);
  perform public.sync_opportunity_to_proposal_in_progress(v_opportunity.id, p_tenant_id);

  perform public.log_audit_event(p_tenant_id, v_user_id, 'proposal.created', 'proposal', v_proposal.id,
    jsonb_build_object('title', v_proposal.title, 'source', 'direct'));
  perform public.log_crm_activity(p_tenant_id, p_client_id, v_opportunity.id, null, 'proposal_created', v_user_id,
    jsonb_build_object('title', v_proposal.title));

  if p_idempotency_key is not null then
    update public.proposal_creation_requests set proposal_id = v_proposal.id
     where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  end if;

  select * into v_proposal from public.proposals where id = v_proposal.id;
  return v_proposal;
end;
$$;

comment on function public.create_proposal_direct(uuid, uuid, text, text, uuid, uuid, text) is
  'Creates a proposal by selecting a client directly. If p_opportunity_id is omitted, a lightweight opportunity is auto-created in the same transaction — see docs/adr/0026-opportunity-auto-creation.md.';

create or replace function public.create_proposal_from_opportunity(
  p_tenant_id uuid,
  p_opportunity_id uuid,
  p_title text,
  p_service_type text,
  p_client_contact_id uuid default null,
  p_idempotency_key text default null
)
returns public.proposals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_opportunity public.opportunities;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_opportunity from public.opportunities where id = p_opportunity_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Opportunity not found in this tenant' using errcode = 'P0002';
  end if;

  -- Delegates every other validation (permission, title, contact ownership,
  -- duplicate-active-proposal, idempotency) to create_proposal_direct() —
  -- the only difference here is the opportunity is required, not optional.
  return public.create_proposal_direct(
    p_tenant_id, v_opportunity.client_id, p_title, p_service_type,
    p_client_contact_id, p_opportunity_id, p_idempotency_key
  );
end;
$$;

comment on function public.create_proposal_from_opportunity(uuid, uuid, text, text, uuid, text) is
  'Creates a proposal linked to an existing opportunity. Thin wrapper over create_proposal_direct() with the opportunity''s client resolved automatically.';

create or replace function public.mark_proposal_ready(p_proposal_id uuid)
returns public.proposals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.proposals;
  v_result public.proposals;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.proposals where id = p_proposal_id;
  if not found then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'proposals.mark_ready') then
    raise exception 'Missing permission: proposals.mark_ready' using errcode = '42501';
  end if;

  if v_row.status = 'ready' then
    return v_row;
  end if;

  if v_row.status <> 'draft' then
    raise exception 'Only a draft proposal can be marked ready' using errcode = '22023';
  end if;

  update public.proposals set status = 'ready' where id = p_proposal_id returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'proposal.marked_ready', 'proposal', p_proposal_id, '{}'::jsonb);
  perform public.log_crm_activity(v_row.tenant_id, v_row.client_id, v_row.opportunity_id, null, 'proposal_marked_ready', v_user_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.mark_proposal_ready(uuid) is
  'draft -> ready. The only forward transition a user can trigger manually in Phase 2A — sent/viewed/accepted/declined/expired are reserved for a later phase.';

create or replace function public.return_proposal_to_draft(p_proposal_id uuid)
returns public.proposals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.proposals;
  v_result public.proposals;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.proposals where id = p_proposal_id;
  if not found then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'proposals.mark_ready') then
    raise exception 'Missing permission: proposals.mark_ready' using errcode = '42501';
  end if;

  if v_row.status = 'draft' then
    return v_row;
  end if;

  if v_row.status <> 'ready' then
    raise exception 'Only a ready proposal can be returned to draft' using errcode = '22023';
  end if;

  update public.proposals set status = 'draft' where id = p_proposal_id returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'proposal.returned_to_draft', 'proposal', p_proposal_id, '{}'::jsonb);
  perform public.log_crm_activity(v_row.tenant_id, v_row.client_id, v_row.opportunity_id, null, 'proposal_returned_to_draft', v_user_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.return_proposal_to_draft(uuid) is
  'ready -> draft. Reverse of mark_proposal_ready(), gated by the same permission.';

create or replace function public.archive_proposal(p_proposal_id uuid)
returns public.proposals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.proposals;
  v_result public.proposals;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.proposals where id = p_proposal_id;
  if not found then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'proposals.archive') then
    raise exception 'Missing permission: proposals.archive' using errcode = '42501';
  end if;

  if v_row.status = 'archived' then
    return v_row;
  end if;

  if v_row.status not in ('draft', 'ready') then
    raise exception 'Only a draft or ready proposal can be archived' using errcode = '22023';
  end if;

  update public.proposals
     set status = 'archived',
         pre_archive_status = v_row.status,
         archived_at = now(),
         archived_by = v_user_id
   where id = p_proposal_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'proposal.archived', 'proposal', p_proposal_id, '{}'::jsonb);
  perform public.log_crm_activity(v_row.tenant_id, v_row.client_id, v_row.opportunity_id, null, 'proposal_archived', v_user_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.archive_proposal(uuid) is
  'Archives a draft or ready proposal. Frees the opportunity to receive a new active proposal (see proposals_one_active_per_opportunity).';

create or replace function public.restore_proposal(p_proposal_id uuid)
returns public.proposals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.proposals;
  v_result public.proposals;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.proposals where id = p_proposal_id;
  if not found then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'proposals.restore') then
    raise exception 'Missing permission: proposals.restore' using errcode = '42501';
  end if;

  if v_row.status <> 'archived' then
    return v_row;
  end if;

  begin
    update public.proposals
       set status = v_row.pre_archive_status,
           pre_archive_status = null,
           archived_at = null,
           archived_by = null
     where id = p_proposal_id
     returning * into v_result;
  exception when unique_violation then
    raise exception 'Cannot restore: this opportunity already has another active proposal' using errcode = '55000';
  end;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'proposal.restored', 'proposal', p_proposal_id, '{}'::jsonb);
  perform public.log_crm_activity(v_row.tenant_id, v_row.client_id, v_row.opportunity_id, null, 'proposal_restored', v_user_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.restore_proposal(uuid) is
  'Restores an archived proposal to whichever of draft/ready it was before archiving. Rejected if the opportunity has since acquired a different active proposal.';

create or replace function public.create_new_proposal_version(p_proposal_id uuid)
returns public.proposal_versions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_proposal public.proposals;
  v_current public.proposal_versions;
  v_new public.proposal_versions;
  v_next_number int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_proposal from public.proposals where id = p_proposal_id;
  if not found then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_proposal.tenant_id, 'proposal_versions.create') then
    raise exception 'Missing permission: proposal_versions.create' using errcode = '42501';
  end if;

  select * into v_current from public.proposal_versions where id = v_proposal.current_version_id for update;
  if not found or v_current.version_status <> 'locked' then
    raise exception 'A new version can only be created from a locked version (this is architecture prep for the sending phase — see docs/31-proposal-state-machines.md)' using errcode = '55000';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_number
    from public.proposal_versions where proposal_id = p_proposal_id;

  insert into public.proposal_versions (
    tenant_id, proposal_id, version_number, version_status, summary, scope_intro,
    estimated_start_date, estimated_duration_days, default_hours_per_day, terms, exclusions,
    notes_for_client, discount_type, discount_value, tax_rate_bps, created_by
  )
  values (
    v_current.tenant_id, p_proposal_id, v_next_number, 'draft', v_current.summary, v_current.scope_intro,
    v_current.estimated_start_date, v_current.estimated_duration_days, v_current.default_hours_per_day,
    v_current.terms, v_current.exclusions, v_current.notes_for_client, v_current.discount_type,
    v_current.discount_value, v_current.tax_rate_bps, v_user_id
  )
  returning * into v_new;

  insert into public.proposal_sections (tenant_id, proposal_version_id, title, description, section_type, sort_order)
  select tenant_id, v_new.id, title, description, section_type, sort_order
    from public.proposal_sections where proposal_version_id = v_current.id and archived_at is null;

  insert into public.proposal_labor_items (tenant_id, proposal_version_id, label, worker_count, estimated_days, hours_per_day, hourly_rate_cents, total_hours, total_cents, sort_order)
  select tenant_id, v_new.id, label, worker_count, estimated_days, hours_per_day, hourly_rate_cents, total_hours, total_cents, sort_order
    from public.proposal_labor_items where proposal_version_id = v_current.id and archived_at is null;

  insert into public.proposal_line_items (tenant_id, proposal_version_id, section_id, category, description, quantity, unit, unit_price_cents, line_total_cents, taxable, sort_order)
  select tenant_id, v_new.id, null, category, description, quantity, unit, unit_price_cents, line_total_cents, taxable, sort_order
    from public.proposal_line_items where proposal_version_id = v_current.id and archived_at is null;

  insert into public.proposal_media (tenant_id, proposal_version_id, media_asset_id, portfolio_project_id, usage_type, caption, sort_order)
  select tenant_id, v_new.id, media_asset_id, portfolio_project_id, usage_type, caption, sort_order
    from public.proposal_media where proposal_version_id = v_current.id and archived_at is null;

  update public.proposal_versions set version_status = 'superseded' where id = v_current.id;
  update public.proposals set current_version_id = v_new.id where id = p_proposal_id;

  perform public.recalculate_proposal_version(v_new.id);

  perform public.log_audit_event(v_proposal.tenant_id, v_user_id, 'proposal.version_created', 'proposal_version', v_new.id,
    jsonb_build_object('proposal_id', p_proposal_id, 'version_number', v_next_number));

  select * into v_new from public.proposal_versions where id = v_new.id;
  return v_new;
end;
$$;

comment on function public.create_new_proposal_version(uuid) is
  'Architecture prep for the sending phase (section 13 of the brief): copies a locked version''s content into a new draft version and marks the old one superseded. Not exposed in the Phase 2A UI — no version ever becomes locked through ordinary use yet.';

-- =============================================================================
-- Grants
-- =============================================================================

revoke execute on function public.create_initial_proposal_version(uuid, uuid, uuid) from public, authenticated;
revoke execute on function public.sync_opportunity_to_proposal_in_progress(uuid, uuid) from public, authenticated;

revoke execute on function public.create_proposal_direct(uuid, uuid, text, text, uuid, uuid, text) from public;
grant execute on function public.create_proposal_direct(uuid, uuid, text, text, uuid, uuid, text) to authenticated;

revoke execute on function public.create_proposal_from_opportunity(uuid, uuid, text, text, uuid, text) from public;
grant execute on function public.create_proposal_from_opportunity(uuid, uuid, text, text, uuid, text) to authenticated;

revoke execute on function public.mark_proposal_ready(uuid) from public;
grant execute on function public.mark_proposal_ready(uuid) to authenticated;

revoke execute on function public.return_proposal_to_draft(uuid) from public;
grant execute on function public.return_proposal_to_draft(uuid) to authenticated;

revoke execute on function public.archive_proposal(uuid) from public;
grant execute on function public.archive_proposal(uuid) to authenticated;

revoke execute on function public.restore_proposal(uuid) from public;
grant execute on function public.restore_proposal(uuid) to authenticated;

revoke execute on function public.create_new_proposal_version(uuid) from public;
grant execute on function public.create_new_proposal_version(uuid) to authenticated;
