-- Phase 3B: Client Portal Accept/Decline — a real gap found by E2E testing.
--
-- 20260718100100 already broadened portal_get_session_context() to accept
-- 'accepted'/'declined' proposals (so an EXISTING session's /view reload
-- keeps working after a response). It missed that the same broadening was
-- needed one step earlier: portal_get_link_info() (the /p/[token] landing
-- page) and portal_request_otp() (requesting a code) BOTH still gated on
-- status in ('ready', 'sent') only -- so a visitor who does not already
-- hold a session cookie (a different device/browser, or the same client
-- coming back after their cookie expired) could no longer even reach the
-- OTP step for an already-answered proposal, let alone see the brief's
-- required "This proposal has already received a response" experience.
-- Caught by tests/e2e/client-portal-response.spec.ts's duplicate-response
-- scenario timing out waiting for a landing-page email field that had
-- silently become a "Link not available" page instead.
--
-- Both forward-fixed (CREATE OR REPLACE, same signatures/return shapes,
-- originals never edited).

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
  -- Phase 3B: 'accepted'/'declined' are now valid too -- a visitor without
  -- an existing session must still be able to reach the OTP step and
  -- ultimately see the final response state, not a dead "unavailable" page.
  if v_proposal.archived_at is not null or v_proposal.status not in ('ready', 'sent', 'accepted', 'declined') then
    return query select v_link.id, v_link.tenant_id, v_link.proposal_id, v_tenant.name, v_proposal.title, false, 'unavailable';
    return;
  end if;

  return query select v_link.id, v_link.tenant_id, v_link.proposal_id, v_tenant.name, v_proposal.title, true, 'ok';
end;
$$;

comment on function public.portal_get_link_info(text) is
  'Landing-page lookup for /p/[token] — validates the link (found, not revoked, not expired, proposal still ready/sent/accepted/declined and not archived) and returns just enough to render the "Prepared for you by {business}" header before any email is entered. Never returns client email/contact info.';

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
  v_client public.clients;
  v_contact public.client_contacts;
  v_email text := lower(btrim(p_email));
  v_recent_link_count int;
  v_recent_email_count int;
  v_matched boolean;
begin
  select * into v_link from public.proposal_portal_links l where l.token_hash = p_token_hash;
  if not found or v_link.status = 'revoked' or v_link.expires_at <= now() then
    return query select 'invalid_link', false;
    return;
  end if;

  -- Phase 3B: 'accepted'/'declined' are now valid too -- see portal_get_link_info() above.
  if not exists (
    select 1 from public.proposals p
    where p.id = v_link.proposal_id and p.archived_at is null and p.status in ('ready', 'sent', 'accepted', 'declined')
  ) then
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
  'Requests a one-time code for a portal link. Valid for a ready/sent/accepted/declined proposal (Phase 3B: a visitor without an existing session must still be able to authenticate and see the final response state). A row is inserted for EVERY request, matched or not (needed for the rate limit to actually throttle email enumeration); email_matched is returned for the CALLER''S internal use only.';
