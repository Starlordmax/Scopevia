-- Phase 3B.1: Proposal Revision / New Version Flow — a real gap found while
-- designing this phase (before it ever reached E2E): portal_get_link_info(),
-- portal_request_otp(), and portal_get_session_context() all gate on the
-- proposal's CURRENT status ('ready'/'sent'/'accepted'/'declined', broadened
-- in 20260718100300 for Phase 3B). The instant create_proposal_revision()
-- runs, proposals.status moves back to 'draft' — which is NOT in that list.
-- An OLD portal link, still bound to the OLD (now superseded, still
-- perfectly readable) proposal_version_id, would suddenly become
-- unreachable: a client re-opening the same link they used to decline the
-- proposal would hit "This proposal is no longer available to view" instead
-- of the declined state they actually saw. This directly breaks the
-- explicit requirement that old links keep showing old content forever.
--
-- Fixed by changing what's being validated: instead of always checking the
-- proposal's CURRENT status, each function now asks "is the version THIS
-- LINK is bound to still legitimately viewable?" — true when either (a) it
-- IS the proposal's current version and that proposal is in a normal
-- viewable status, or (b) it is a past version that was actually locked/
-- superseded (i.e. a real, finalized snapshot the client legitimately saw
-- and/or responded to — never a version abandoned mid-draft, which should
-- never have had a link pointing at it in the first place). Archived
-- proposals remain unavailable either way.
--
-- All three forward-fixed (CREATE OR REPLACE, same signatures/return
-- shapes, originals never edited).

create or replace function public.portal_get_link_info(p_token_hash text)
returns table (
  link_id uuid,
  tenant_id uuid,
  proposal_id uuid,
  business_name text,
  proposal_title text,
  is_valid boolean,
  status_reason text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.proposal_portal_links;
  v_proposal public.proposals;
  v_tenant public.tenants;
  v_bound_version_status text;
begin
  select * into v_link from public.proposal_portal_links l where l.token_hash = p_token_hash;
  if not found then
    return query select null::uuid, null::uuid, null::uuid, null::text, null::text, false, 'not_found';
    return;
  end if;

  select * into v_proposal from public.proposals where id = v_link.proposal_id;
  select * into v_tenant from public.tenants where id = v_link.tenant_id;

  if v_link.status = 'revoked' then
    return query select v_link.id, v_link.tenant_id, v_link.proposal_id, v_tenant.name, v_proposal.title, false, 'revoked';
    return;
  end if;
  if v_link.expires_at <= now() then
    return query select v_link.id, v_link.tenant_id, v_link.proposal_id, v_tenant.name, v_proposal.title, false, 'expired';
    return;
  end if;

  select version_status into v_bound_version_status from public.proposal_versions where id = v_link.proposal_version_id;

  if v_proposal.archived_at is not null then
    return query select v_link.id, v_link.tenant_id, v_link.proposal_id, v_tenant.name, v_proposal.title, false, 'unavailable';
    return;
  end if;

  if v_proposal.current_version_id = v_link.proposal_version_id then
    if v_proposal.status not in ('ready', 'sent', 'accepted', 'declined') then
      return query select v_link.id, v_link.tenant_id, v_link.proposal_id, v_tenant.name, v_proposal.title, false, 'unavailable';
      return;
    end if;
  elsif v_bound_version_status not in ('locked', 'superseded') then
    -- A link bound to a non-current version that was never actually
    -- finalized (shouldn't normally happen) is not shown as a live proposal.
    return query select v_link.id, v_link.tenant_id, v_link.proposal_id, v_tenant.name, v_proposal.title, false, 'unavailable';
    return;
  end if;

  return query select v_link.id, v_link.tenant_id, v_link.proposal_id, v_tenant.name, v_proposal.title, true, 'ok';
end;
$$;

comment on function public.portal_get_link_info(text) is
  'Landing-page lookup for /p/[token] — validates the link (found, not revoked, not expired) and the proposal (not archived). A link bound to the proposal''s CURRENT version requires status ready/sent/accepted/declined; a link bound to a HISTORICAL (superseded) version stays valid regardless of the proposal''s current status (Phase 3B.1: old links must keep working after a revision — see docs/58-proposal-revision-flow.md). Never returns client email/contact info.';

create or replace function public.portal_request_otp(
  p_token_hash text,
  p_email text,
  p_code_hash text,
  p_expires_at timestamptz,
  p_ip_hash text,
  p_user_agent_hash text
)
returns table (outcome text, email_matched boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.proposal_portal_links;
  v_proposal public.proposals;
  v_bound_version_status text;
  v_client public.clients;
  v_contact public.client_contacts;
  v_email text := lower(btrim(p_email));
  v_recent_link_count int;
  v_recent_email_count int;
  v_matched boolean;
  v_link_is_valid boolean;
begin
  select * into v_link from public.proposal_portal_links l where l.token_hash = p_token_hash;
  if not found or v_link.status = 'revoked' or v_link.expires_at <= now() then
    return query select 'invalid_link', false;
    return;
  end if;

  select * into v_proposal from public.proposals where id = v_link.proposal_id;
  select version_status into v_bound_version_status from public.proposal_versions where id = v_link.proposal_version_id;

  v_link_is_valid := v_proposal.id is not null and v_proposal.archived_at is null and (
    (v_proposal.current_version_id = v_link.proposal_version_id and v_proposal.status in ('ready', 'sent', 'accepted', 'declined'))
    or (v_proposal.current_version_id <> v_link.proposal_version_id and v_bound_version_status in ('locked', 'superseded'))
  );

  -- Phase 3B.1: a historical link (bound to a version a revision has since
  -- superseded) stays valid the same way it does in portal_get_link_info().
  if not v_link_is_valid then
    return query select 'invalid_link', false;
    return;
  end if;

  select count(*) into v_recent_link_count
    from public.proposal_portal_otps
    where portal_link_id = v_link.id and created_at > now() - interval '15 minutes';
  if v_recent_link_count >= 8 then
    return query select 'rate_limited', false;
    return;
  end if;

  select count(*) into v_recent_email_count
    from public.proposal_portal_otps
    where portal_link_id = v_link.id and lower(client_email) = v_email and created_at > now() - interval '15 minutes';
  if v_recent_email_count >= 3 then
    return query select 'rate_limited', false;
    return;
  end if;

  select c.* into v_client from public.proposals p join public.clients c on c.id = p.client_id where p.id = v_link.proposal_id;
  select cc.* into v_contact
    from public.proposals p
    join public.client_contacts cc on cc.id = p.client_contact_id
    where p.id = v_link.proposal_id;

  v_matched := (v_client.email is not null and lower(btrim(v_client.email)) = v_email)
    or (v_contact.email is not null and lower(btrim(v_contact.email)) = v_email);

  insert into public.proposal_portal_otps (tenant_id, proposal_id, portal_link_id, client_email, code_hash, expires_at, ip_hash, user_agent_hash)
  values (v_link.tenant_id, v_link.proposal_id, v_link.id, v_email, p_code_hash, p_expires_at, p_ip_hash, p_user_agent_hash);

  if v_matched then
    perform public.log_audit_event(v_link.tenant_id, null, 'portal_otp.requested', 'proposal_portal_link', v_link.id,
      jsonb_build_object('proposal_id', v_link.proposal_id));
  end if;

  return query select 'ok', v_matched;
end;
$$;

comment on function public.portal_request_otp(text, text, text, timestamptz, text, text) is
  'Requests a one-time code for a portal link. Valid whenever the link''s bound version is legitimately viewable — either it is the proposal''s current version in a normal status, or a historical (superseded) version left behind by a revision (Phase 3B.1). A row is inserted for EVERY request, matched or not (needed for the rate limit to actually throttle email enumeration); email_matched is returned for the CALLER''S internal use only.';

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
  v_bound_version_status text;
  v_is_first_view boolean;
  v_context_is_valid boolean;
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
  select version_status into v_bound_version_status from public.proposal_versions where id = v_link.proposal_version_id;

  -- Phase 3B.1: a session created against a link that a revision has since
  -- made historical must keep working too, the same way portal_get_link_info()
  -- and portal_request_otp() do — otherwise a client mid-session when a
  -- revision happens would be bounced on their very next reload.
  v_context_is_valid := found and v_proposal.archived_at is null and (
    (v_proposal.current_version_id = v_link.proposal_version_id and v_proposal.status in ('ready', 'sent', 'accepted', 'declined'))
    or (v_proposal.current_version_id <> v_link.proposal_version_id and v_bound_version_status in ('locked', 'superseded'))
  );

  if not v_context_is_valid then
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
  'Validates a portal session cookie on every /p/[token]/view load and records a view event. A session bound to the proposal''s current version requires status ready/sent/accepted/declined; a session bound to a historical (superseded) version, left behind by a revision, stays valid regardless (Phase 3B.1). Returns just the ids needed to load the proposal; the caller loads the actual FullProposal-shaped data (and any existing response) via the admin client afterward.';
