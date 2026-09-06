-- Phase 3D: Email Notifications for Client Portal Events — functions.
--
-- 1. get_proposal_notification_recipients() — new. Resolves the "notify the
--    team" recipient list: active (not invited/suspended/removed)
--    memberships with an owner/admin/estimator/sales role. Portal-facing
--    discipline (revoked from public/anon/authenticated, service_role
--    only) even though every current caller is itself portal-visitor-
--    triggered — see docs/62-proposal-email-notifications.md, "Recipients."
--
-- 2. portal_get_session_context() — forward-fixed (DROP + CREATE, since the
--    RETURN TABE shape is changing, not just internal logic — Postgres
--    disallows CREATE OR REPLACE across a return-type change) to also
--    return `is_first_view` and `client_email`, both already computed/read
--    internally but previously discarded. This lets the TypeScript caller
--    (the /view and /print page loads) decide whether to fire a
--    "proposal viewed" notification WITHOUT a second query and without
--    re-deriving "was this the first view" itself (which would risk a
--    race the RPC's own row lock/update already avoids as well as it can).
--
-- 3. submit_proposal_client_response() — same treatment: now also returns
--    `tenant_id`, `proposal_id`, `proposal_version_id`, `client_email`, and
--    `responded_at` on top of the existing `outcome`/`response_type`, so
--    acceptProposalAction()/declineProposalAction() can build a
--    notification without a second lookup. Every added field was already
--    resolved inside the function body — nothing new is computed, only
--    returned.
--
-- Neither function's validation/security logic changes even slightly —
-- see docs/63-notification-delivery-security.md for why this was safe to
-- do without re-deriving any of Phase 3A/3B/3B.1's already-verified
-- behavior.

create or replace function public.get_proposal_notification_recipients(p_tenant_id uuid)
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id, u.email
  from public.tenant_memberships tm
  join public.roles r on r.id = tm.role_id
  join auth.users u on u.id = tm.user_id
  where tm.tenant_id = p_tenant_id
    and tm.status = 'active'
    and r.key in ('owner', 'admin', 'estimator', 'sales')
    and u.email is not null;
$$;

comment on function public.get_proposal_notification_recipients(uuid) is
  'Active Owner/Admin/Estimator/Sales members of a tenant, for Client Portal event email notifications (Phase 3D). Excludes Viewer, Field Worker, and any invited/suspended/removed membership. Portal-facing discipline — see grants below.';

revoke execute on function public.get_proposal_notification_recipients(uuid) from public, anon, authenticated;

drop function if exists public.portal_get_session_context(text, text, text);

create function public.portal_get_session_context(
  p_session_token_hash text,
  p_ip_hash text,
  p_user_agent_hash text
)
returns table (
  outcome text,
  tenant_id uuid,
  proposal_id uuid,
  proposal_version_id uuid,
  is_first_view boolean,
  client_email text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.proposal_portal_sessions;
  v_link public.proposal_portal_links;
  v_proposal public.proposals;
  v_bound_version_status text;
  v_is_first_view boolean;
  v_context_is_valid boolean;
begin
  select * into v_session from public.proposal_portal_sessions s where s.session_token_hash = p_session_token_hash;
  if not found or v_session.revoked_at is not null or v_session.expires_at <= now() then
    return query select 'invalid_session', null::uuid, null::uuid, null::uuid, null::boolean, null::text;
    return;
  end if;

  select * into v_link from public.proposal_portal_links where id = v_session.portal_link_id;
  if not found or v_link.status = 'revoked' then
    return query select 'invalid_session', null::uuid, null::uuid, null::uuid, null::boolean, null::text;
    return;
  end if;

  select * into v_proposal from public.proposals where id = v_session.proposal_id;
  select version_status into v_bound_version_status from public.proposal_versions where id = v_link.proposal_version_id;

  v_context_is_valid := found and v_proposal.archived_at is null and (
    (v_proposal.current_version_id = v_link.proposal_version_id and v_proposal.status in ('ready', 'sent', 'accepted', 'declined'))
    or (v_proposal.current_version_id <> v_link.proposal_version_id and v_bound_version_status in ('locked', 'superseded'))
  );

  if not v_context_is_valid then
    return query select 'invalid_session', null::uuid, null::uuid, null::uuid, null::boolean, null::text;
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

  return query select 'ok', v_session.tenant_id, v_session.proposal_id, v_link.proposal_version_id, v_is_first_view, v_session.client_email;
end;
$$;

comment on function public.portal_get_session_context(text, text, text) is
  'Validates a portal session cookie on every /p/[token]/view or /p/[token]/print load and records a view event. Re-checks the underlying link status and proposal status on every single call — see docs/59-proposal-version-history.md for the historical-version behavior. is_first_view (Phase 3D) tells the caller whether to fire a "proposal viewed" notification, without a second query.';

revoke execute on function public.portal_get_session_context(text, text, text) from public, anon, authenticated;

drop function if exists public.submit_proposal_client_response(text, text, text, text, boolean, text, text);

create function public.submit_proposal_client_response(
  p_session_token_hash text,
  p_response_type text,
  p_client_name text,
  p_decline_reason text,
  p_accepted_terms boolean,
  p_ip_hash text,
  p_user_agent_hash text
)
returns table (
  outcome text,
  response_type text,
  tenant_id uuid,
  proposal_id uuid,
  proposal_version_id uuid,
  client_email text,
  responded_at timestamptz
)
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
    return query select 'invalid_session', null::text, null::uuid, null::uuid, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  select * into v_link from public.proposal_portal_links where id = v_session.portal_link_id;
  if not found or v_link.status = 'revoked' then
    return query select 'invalid_session', null::text, null::uuid, null::uuid, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  select * into v_proposal from public.proposals where id = v_session.proposal_id;
  if not found then
    return query select 'invalid_session', null::text, null::uuid, null::uuid, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  -- Checked BEFORE the generic archived/status gate below, so a
  -- second response attempt gets the specific, honest "already_responded"
  -- outcome rather than a generic "invalid_session".
  if v_proposal.status in ('accepted', 'declined') then
    return query select 'already_responded', null::text, null::uuid, null::uuid, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  if v_proposal.archived_at is not null or v_proposal.status not in ('ready', 'sent') then
    return query select 'invalid_session', null::text, null::uuid, null::uuid, null::uuid, null::text, null::timestamptz;
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
    return query select 'already_responded', null::text, null::uuid, null::uuid, null::uuid, null::text, null::timestamptz;
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

  return query select 'ok', p_response_type, v_session.tenant_id, v_session.proposal_id, v_link.proposal_version_id, v_session.client_email, v_response.responded_at;
end;
$$;

comment on function public.submit_proposal_client_response(text, text, text, text, boolean, text, text) is
  'Records a client''s final accept/decline decision (Phase 3B). Locks the responded-to proposal_version_id and sets proposals.status to accepted/declined. outcome is one of: ok, invalid_session, already_responded. Never accepts a client-supplied tenant/proposal/version id — everything is derived from the session the caller already holds. Phase 3D: also returns tenant_id/proposal_id/proposal_version_id/client_email/responded_at (already resolved internally) so the caller can fire a notification without a second lookup — see docs/62-proposal-email-notifications.md.';

revoke execute on function public.submit_proposal_client_response(text, text, text, text, boolean, text, text) from public, anon, authenticated;
