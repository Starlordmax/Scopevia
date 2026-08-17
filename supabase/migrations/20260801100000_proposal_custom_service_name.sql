-- Custom service name — when a proposal's service_type is 'custom', the
-- contractor needs to say WHAT the custom service actually is (e.g.
-- "Deck repair"), so it can be shown as a real name everywhere the
-- service type is displayed (builder, preview, Client Portal, print)
-- instead of the bare word "custom". See
-- docs/74-custom-service-name-and-multistroke-drawing.md.
--
-- service_type lives on `proposals` (not per-measurement-group) --
-- confirmed by inspecting the current model before writing this
-- migration: proposal_measurement_groups.service_type exists in the
-- schema but has no UI writer anywhere in the app (createMeasurementGroupSchema
-- accepts it, but GroupForm in step-measurements.tsx never renders a
-- field for it) -- the actual, user-facing "Service type" selector with a
-- "Custom" option lives only on the New Proposal form
-- (new-proposal-form.tsx / createProposalDirectSchema), one per proposal,
-- set once at creation. Storing custom_service_name on `proposals`
-- itself (not a new table, not the measurement group) keeps it colocated
-- with service_type, matching the brief's own recommendation ("guardar
-- custom_service_name donde se guarda el service type").
--
-- Nullable: only meaningful (and only required) when service_type =
-- 'custom' -- enforced by a CHECK constraint here as defense-in-depth,
-- and by an explicit friendly-message raise inside create_proposal_direct()
-- below (the actual first line of defense a user sees).

alter table public.proposals
  add column custom_service_name text check (custom_service_name is null or char_length(btrim(custom_service_name)) between 1 and 160);

-- Backfill pre-existing 'custom'-service-type proposals (from before this
-- column existed, including test/staging data) before the CHECK below
-- makes an empty custom_service_name illegal for that service_type --
-- see docs/74, "Known limitations" for this fallback's user-facing
-- equivalent (serviceTypeLabel()'s "Custom service" default for old data
-- with no name at all).
update public.proposals
   set custom_service_name = 'Custom service'
 where service_type = 'custom' and (custom_service_name is null or btrim(custom_service_name) = '');

alter table public.proposals
  add constraint proposals_custom_service_name_required_check
  check (service_type <> 'custom' or (custom_service_name is not null and btrim(custom_service_name) <> ''));

comment on column public.proposals.custom_service_name is
  'Human-readable name for a custom service (e.g. "Deck repair") -- required when service_type = ''custom'', always null otherwise. Rendered in place of the bare word "custom" in the builder, preview, Client Portal, and print/export. See docs/74-custom-service-name-and-multistroke-drawing.md.';

-- create_proposal_direct()/create_proposal_from_opportunity() both gain a
-- new trailing p_custom_service_name param -- a DIFFERENT parameter count
-- than the currently-applied versions, so per this project's own
-- hard-learned lesson (20260730100300_fix_client_functions_duplicate_overload.sql),
-- CREATE OR REPLACE alone would create a SECOND, orphaned overload rather
-- than truly replacing them. Both old-signature functions are dropped
-- first, then recreated, then re-granted explicitly.

drop function if exists public.create_proposal_direct(uuid, uuid, text, text, uuid, uuid, text);
drop function if exists public.create_proposal_from_opportunity(uuid, uuid, text, text, uuid, text);

create or replace function public.create_proposal_direct(
  p_tenant_id uuid,
  p_client_id uuid,
  p_title text,
  p_service_type text,
  p_client_contact_id uuid default null,
  p_opportunity_id uuid default null,
  p_idempotency_key text default null,
  p_custom_service_name text default null
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
  v_custom_service_name text;
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

  -- Never persist a stray custom name for a non-custom service type
  -- (e.g. a client re-submitting a stale form after switching service
  -- types) -- always null unless service_type is actually 'custom'.
  if p_service_type = 'custom' then
    if p_custom_service_name is null or btrim(p_custom_service_name) = '' then
      raise exception 'Enter a name for this custom service.' using errcode = '22023';
    end if;
    v_custom_service_name := btrim(p_custom_service_name);
  else
    v_custom_service_name := null;
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
    title, service_type, custom_service_name, source, created_by
  )
  values (
    p_tenant_id, v_number, p_client_id, p_client_contact_id, v_opportunity.id,
    btrim(p_title), p_service_type, v_custom_service_name, 'direct', v_user_id
  )
  returning * into v_proposal;

  perform public.create_initial_proposal_version(p_tenant_id, v_proposal.id, v_user_id, v_client.postal_code);
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

comment on function public.create_proposal_direct(uuid, uuid, text, text, uuid, uuid, text, text) is
  'Creates a proposal by selecting a client directly. If p_opportunity_id is omitted, a lightweight opportunity is auto-created in the same transaction — see docs/adr/0026-opportunity-auto-creation.md. The initial version''s pricing ZIP defaults from the client''s own postal_code, if it looks like a valid 5-digit US ZIP. p_custom_service_name is required (and trimmed/stored) when p_service_type = ''custom'', always null otherwise — see docs/74-custom-service-name-and-multistroke-drawing.md.';

create or replace function public.create_proposal_from_opportunity(
  p_tenant_id uuid,
  p_opportunity_id uuid,
  p_title text,
  p_service_type text,
  p_client_contact_id uuid default null,
  p_idempotency_key text default null,
  p_custom_service_name text default null
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
  -- duplicate-active-proposal, idempotency, custom service name) to
  -- create_proposal_direct() — the only difference here is the
  -- opportunity is required, not optional.
  return public.create_proposal_direct(
    p_tenant_id, v_opportunity.client_id, p_title, p_service_type,
    p_client_contact_id, p_opportunity_id, p_idempotency_key, p_custom_service_name
  );
end;
$$;

comment on function public.create_proposal_from_opportunity(uuid, uuid, text, text, uuid, text, text) is
  'Creates a proposal linked to an existing opportunity. Thin wrapper over create_proposal_direct() with the opportunity''s client resolved automatically.';

grant execute on function public.create_proposal_direct(uuid, uuid, text, text, uuid, uuid, text, text) to authenticated;
grant execute on function public.create_proposal_from_opportunity(uuid, uuid, text, text, uuid, text, text) to authenticated;
