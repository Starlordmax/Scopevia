-- Phase 3B: Client Portal Accept/Decline — functions.
--
-- 1. submit_proposal_client_response() — the ONLY way to record a client's
--    accept/decline decision. Portal-facing (anonymous visitor, already
--    holding a verified session), called exclusively via the service-role
--    admin client, same discipline as every portal_*() function from
--    Phase 3A — see docs/57-client-response-security.md.
--
-- 2. portal_get_session_context() — forward-fixed (CREATE OR REPLACE, same
--    signature/return shape, original never edited) to also accept
--    'accepted'/'declined' proposals, not just 'ready'/'sent'. Without this,
--    the instant a client accepted or declined, THEIR OWN next page load
--    (or a reload) of /p/[token]/view would be rejected as "invalid_session"
--    — the whole point of Phase 3B is that the client sees a final
--    "Proposal accepted"/"Proposal declined" state afterward, not a broken
--    link.

create or replace function public.submit_proposal_client_response(
  p_session_token_hash text,
  p_response_type text,
  p_client_name text,
  p_decline_reason text,
  p_accepted_terms boolean,
  p_ip_hash text,
  p_user_agent_hash text
)
returns table (outcome text, response_type text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.proposal_portal_sessions;
  v_link public.proposal_portal_links;
  v_proposal public.proposals;
  v_response public.proposal_client_responses;
begin
  if p_response_type not in ('accepted', 'declined') then
    raise exception 'Invalid response type' using errcode = '22023';
  end if;

  select * into v_session from public.proposal_portal_sessions s where s.session_token_hash = p_session_token_hash;
  if not found or v_session.revoked_at is not null or v_session.expires_at <= now() then
    return query select 'invalid_session', null::text;
    return;
  end if;

  select * into v_link from public.proposal_portal_links where id = v_session.portal_link_id;
  if not found or v_link.status = 'revoked' then
    return query select 'invalid_session', null::text;
    return;
  end if;

  select * into v_proposal from public.proposals where id = v_session.proposal_id;
  if not found then
    return query select 'invalid_session', null::text;
    return;
  end if;

  -- Checked BEFORE the generic archived/status gate below, so a
  -- second response attempt gets the specific, honest "already_responded"
  -- outcome rather than a generic "invalid_session".
  if v_proposal.status in ('accepted', 'declined') then
    return query select 'already_responded', null::text;
    return;
  end if;

  if v_proposal.archived_at is not null or v_proposal.status not in ('ready', 'sent') then
    return query select 'invalid_session', null::text;
    return;
  end if;

  if p_response_type = 'accepted' then
    if p_accepted_terms is distinct from true then
      raise exception 'You must confirm you have reviewed the proposal before accepting' using errcode = '22023';
    end if;
    if p_client_name is null or btrim(p_client_name) = '' then
      raise exception 'Your name is required to accept' using errcode = '22023';
    end if;
  end if;

  begin
    insert into public.proposal_client_responses (
      tenant_id, proposal_id, proposal_version_id, portal_link_id, portal_session_id,
      client_email, client_name, response_type, decline_reason, accepted_terms, ip_hash, user_agent_hash
    )
    values (
      v_session.tenant_id, v_session.proposal_id, v_link.proposal_version_id, v_link.id, v_session.id,
      v_session.client_email, nullif(btrim(coalesce(p_client_name, '')), ''), p_response_type,
      nullif(btrim(coalesce(p_decline_reason, '')), ''), coalesce(p_accepted_terms, false),
      p_ip_hash, p_user_agent_hash
    )
    returning * into v_response;
  exception when unique_violation then
    -- A race: two submissions for the same version landed concurrently.
    -- The unique(proposal_version_id) constraint is the true guard; this
    -- is just translating its failure into the same friendly outcome the
    -- pre-check above already returns for the non-racing case.
    return query select 'already_responded', null::text;
    return;
  end;

  -- Lock the version as an immutable historical record of exactly what the
  -- client responded to — no silent edit is possible afterward (see
  -- prevent_locked_proposal_version_mutation() / prevent_locked_version_child_mutation(),
  -- both already enforced since Phase 2A, exercised in real usage for the
  -- first time by this function).
  update public.proposal_versions set version_status = 'locked', locked_at = now()
    where id = v_link.proposal_version_id and version_status = 'draft';

  update public.proposals set status = p_response_type where id = v_session.proposal_id;

  perform public.log_audit_event(
    v_session.tenant_id, null,
    case p_response_type when 'accepted' then 'proposal.accepted_by_client' else 'proposal.declined_by_client' end,
    'proposal', v_session.proposal_id,
    jsonb_build_object('proposal_version_id', v_link.proposal_version_id, 'portal_link_id', v_link.id)
  );

  perform public.log_crm_activity(
    v_session.tenant_id, v_proposal.client_id, v_proposal.opportunity_id, null,
    case p_response_type when 'accepted' then 'proposal_accepted_by_client' else 'proposal_declined_by_client' end,
    null,
    jsonb_build_object('title', v_proposal.title)
  );

  return query select 'ok', p_response_type;
end;
$$;

comment on function public.submit_proposal_client_response(text, text, text, text, boolean, text, text) is
  'Records a client''s final accept/decline decision (Phase 3B). Locks the responded-to proposal_version_id and sets proposals.status to accepted/declined. outcome is one of: ok, invalid_session, already_responded. Never accepts a client-supplied tenant/proposal/version id — everything is derived from the session the caller already holds (see docs/57).';

create or replace function public.portal_get_session_context(
  p_session_token_hash text,
  p_ip_hash text,
  p_user_agent_hash text
)
returns table (outcome text, tenant_id uuid, proposal_id uuid, proposal_version_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.proposal_portal_sessions;
  v_link public.proposal_portal_links;
  v_proposal public.proposals;
  v_is_first_view boolean;
begin
  select * into v_session from public.proposal_portal_sessions s where s.session_token_hash = p_session_token_hash;
  if not found or v_session.revoked_at is not null or v_session.expires_at <= now() then
    return query select 'invalid_session', null::uuid, null::uuid, null::uuid;
    return;
  end if;

  select * into v_link from public.proposal_portal_links where id = v_session.portal_link_id;
  if not found or v_link.status = 'revoked' then
    return query select 'invalid_session', null::uuid, null::uuid, null::uuid;
    return;
  end if;

  select * into v_proposal from public.proposals where id = v_session.proposal_id;
  -- Phase 3B: 'accepted'/'declined' are now valid too -- the client must
  -- still be able to view the proposal (and its final response state)
  -- after responding, not get bounced back to the landing page.
  if not found or v_proposal.archived_at is not null or v_proposal.status not in ('ready', 'sent', 'accepted', 'declined') then
    return query select 'invalid_session', null::uuid, null::uuid, null::uuid;
    return;
  end if;

  v_is_first_view := v_session.last_seen_at = v_session.created_at;

  update public.proposal_portal_sessions set last_seen_at = now() where id = v_session.id;

  insert into public.proposal_view_events (tenant_id, proposal_id, proposal_version_id, portal_link_id, client_email, ip_hash, user_agent_hash)
  values (v_session.tenant_id, v_session.proposal_id, v_link.proposal_version_id, v_link.id, v_session.client_email, p_ip_hash, p_user_agent_hash);

  if v_is_first_view then
    perform public.log_audit_event(v_session.tenant_id, null, 'proposal.viewed', 'proposal', v_session.proposal_id,
      jsonb_build_object('portal_link_id', v_link.id));
    perform public.log_crm_activity(v_session.tenant_id, v_proposal.client_id, v_proposal.opportunity_id, null,
      'proposal_viewed_by_client', null, jsonb_build_object('title', v_proposal.title));
  end if;

  return query select 'ok', v_session.tenant_id, v_session.proposal_id, v_link.proposal_version_id;
end;
$$;

comment on function public.portal_get_session_context(text, text, text) is
  'Validates a portal session cookie on every /p/[token]/view load and records a view event. Re-checks the underlying link status and proposal status on every single call. Accepts ready/sent/accepted/declined proposal statuses (Phase 3B: a client must still be able to view the proposal after responding) — draft/archived/anything else is rejected. Returns just the ids needed to load the proposal; the caller loads the actual FullProposal-shaped data (and any existing response) via the admin client afterward.';

-- =============================================================================
-- Grants
-- =============================================================================

-- Portal-facing, never granted to anon/authenticated — same discipline as
-- every other portal_*() function, see docs/57.
revoke execute on function public.submit_proposal_client_response(text, text, text, text, boolean, text, text) from public, anon, authenticated;
