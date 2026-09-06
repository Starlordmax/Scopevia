-- Defaults a new proposal's Materials & Costs pricing ZIP from its
-- client's address, if the client has a postal_code that looks like a
-- valid 5-digit US ZIP (proposal_versions.pricing_zip_code's own CHECK is
-- '^\d{5}$' -- US-only, matching the material-pricing system's own scope,
-- see docs/42-material-catalog-by-zip.md). A client's postal_code is
-- deliberately more lenient (international-ready, ZIP+4 allowed) since
-- it's a general address field -- this is normalized down to the first 5
-- digits here, at the one point it's actually used for US pricing.
--
-- This ONLY sets the value at creation time. update_proposal_pricing_zip()
-- (unchanged) is the only other writer of this column, so a user's manual
-- override on the Materials step is never re-clobbered by this default --
-- there is no code path that re-runs this logic after creation.
--
-- create_initial_proposal_version() is internal-only (called exclusively
-- by create_proposal_direct(), which create_proposal_from_opportunity()
-- itself delegates to) -- extending its signature here is safe and has no
-- other caller to update.

create or replace function public.create_initial_proposal_version(
  p_tenant_id uuid,
  p_proposal_id uuid,
  p_actor uuid,
  p_pricing_zip_code text default null
)
returns public.proposal_versions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings public.tenant_proposal_settings;
  v_version public.proposal_versions;
  v_zip text;
begin
  v_settings := public.ensure_tenant_proposal_settings(p_tenant_id);

  -- Silently drop anything that isn't a clean 5-digit US ZIP rather than
  -- raising -- this is a best-effort convenience default, not a user-
  -- facing validation point, and a legacy/foreign client address must
  -- never block proposal creation.
  if p_pricing_zip_code is not null and substring(p_pricing_zip_code from 1 for 5) ~ '^\d{5}$' then
    v_zip := substring(p_pricing_zip_code from 1 for 5);
  else
    v_zip := null;
  end if;

  insert into public.proposal_versions (
    tenant_id, proposal_id, version_number, version_status,
    default_hours_per_day, terms, exclusions, tax_rate_bps, pricing_zip_code, created_by
  )
  values (
    p_tenant_id, p_proposal_id, 1, 'draft',
    v_settings.default_hours_per_day, v_settings.default_terms, v_settings.default_exclusions,
    v_settings.default_tax_rate_bps, v_zip, p_actor
  )
  returning * into v_version;

  update public.proposals set current_version_id = v_version.id where id = p_proposal_id;

  perform public.recalculate_proposal_version(v_version.id);
  select * into v_version from public.proposal_versions where id = v_version.id;
  return v_version;
end;
$$;

comment on function public.create_initial_proposal_version(uuid, uuid, uuid, text) is
  'Creates version 1 (draft) for a brand-new proposal, seeded from the tenant''s default settings and, if it looks like a valid 5-digit US ZIP, the client''s own postal_code as the default Materials & Costs pricing ZIP. Internal only -- called by create_proposal_direct()/create_proposal_from_opportunity().';

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

comment on function public.create_proposal_direct(uuid, uuid, text, text, uuid, uuid, text) is
  'Creates a proposal by selecting a client directly. If p_opportunity_id is omitted, a lightweight opportunity is auto-created in the same transaction — see docs/adr/0026-opportunity-auto-creation.md. The initial version''s pricing ZIP defaults from the client''s own postal_code, if it looks like a valid 5-digit US ZIP.';
