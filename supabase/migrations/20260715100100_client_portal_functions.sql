-- Phase 3A: Client Portal — functions.
--
-- Two groups:
--
-- 1. Internal (contractor-facing): create_proposal_portal_link(),
--    revoke_proposal_portal_link(). Called with the CONTRACTOR's own
--    authenticated session (src/lib/supabase/server.ts), exactly like every
--    other mutation function in this codebase — user_has_permission() +
--    auth.uid() work normally here.
--
-- 2. Portal-facing (anonymous visitor): portal_get_link_info(),
--    portal_request_otp(), portal_verify_otp(), portal_get_session_context().
--    A portal visitor has no Supabase Auth session at all, so auth.uid() is
--    always null for these — they are called EXCLUSIVELY through the
--    service-role admin client (src/lib/supabase/admin.ts) from the public
--    /p/[token]* route handlers, and take an explicit token/code/session
--    HASH as their only means of identifying "who is asking" — never a
--    tenant_id/proposal_id passed straight from the client, and never a
--    permission check, since there is no permission system to check against
--    an anonymous visitor. Every one of these functions independently
--    re-validates link/OTP/session status (revoked/expired/consumed) itself
--    rather than trusting the caller. See docs/53-client-portal-security.md.

-- =============================================================================
-- 1. Internal: create / revoke a portal link
-- =============================================================================

create or replace function public.create_proposal_portal_link(
  p_tenant_id uuid,
  p_proposal_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns public.proposal_portal_links
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_proposal public.proposals;
  v_row public.proposal_portal_links;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.user_has_permission(p_tenant_id, 'proposal_portal_links.create') then
    raise exception 'Missing permission: proposal_portal_links.create' using errcode = '42501';
  end if;

  select * into v_proposal from public.proposals where id = p_proposal_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;
  if v_proposal.archived_at is not null then
    raise exception 'Cannot create a client portal link for an archived proposal' using errcode = '23514';
  end if;
  -- 'sent' is listed for forward-compatibility (docs/31) — no function can
  -- set a proposal to 'sent' yet in this phase, so 'ready' is the only
  -- status a link can actually be created from today.
  if v_proposal.status not in ('ready', 'sent') then
    raise exception 'Only a ready proposal can have a client portal link' using errcode = '23514';
  end if;
  if v_proposal.current_version_id is null then
    raise exception 'Proposal has no version to share' using errcode = '23514';
  end if;

  if p_token_hash is null or length(p_token_hash) < 32 then
    raise exception 'Invalid token' using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'Expiration must be in the future' using errcode = '22023';
  end if;

  insert into public.proposal_portal_links (tenant_id, proposal_id, proposal_version_id, token_hash, expires_at, created_by)
  values (p_tenant_id, p_proposal_id, v_proposal.current_version_id, p_token_hash, p_expires_at, v_user_id)
  returning * into v_row;

  perform public.log_audit_event(p_tenant_id, v_user_id, 'portal_link.created', 'proposal_portal_link', v_row.id,
    jsonb_build_object('proposal_id', p_proposal_id));
  perform public.log_crm_activity(p_tenant_id, v_proposal.client_id, v_proposal.opportunity_id, null,
    'client_portal_link_created', v_user_id, jsonb_build_object('proposal_id', p_proposal_id, 'title', v_proposal.title));

  return v_row;
end;
$$;

comment on function public.create_proposal_portal_link(uuid, uuid, text, timestamptz) is
  'Creates a client portal link for a ready proposal. p_token_hash is the SHA-256 hex digest of a raw token generated in TS (src/lib/portal/tokens.ts) — the raw token is returned to the caller once, by the Server Action, and never reaches this function or the database in plaintext.';

create or replace function public.revoke_proposal_portal_link(p_portal_link_id uuid)
returns public.proposal_portal_links
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.proposal_portal_links;
  v_proposal public.proposals;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.proposal_portal_links where id = p_portal_link_id;
  if not found then
    raise exception 'Portal link not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'proposal_portal_links.revoke') then
    raise exception 'Missing permission: proposal_portal_links.revoke' using errcode = '42501';
  end if;

  if v_row.status = 'revoked' then
    return v_row; -- idempotent — revoking twice is a no-op, not an error
  end if;

  update public.proposal_portal_links
    set status = 'revoked', revoked_at = now(), revoked_by = v_user_id
    where id = p_portal_link_id
    returning * into v_row;

  select * into v_proposal from public.proposals where id = v_row.proposal_id;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'portal_link.revoked', 'proposal_portal_link', v_row.id, '{}'::jsonb);
  perform public.log_crm_activity(v_row.tenant_id, v_proposal.client_id, v_proposal.opportunity_id, null,
    'client_portal_link_revoked', v_user_id, '{}'::jsonb);

  return v_row;
end;
$$;

comment on function public.revoke_proposal_portal_link(uuid) is
  'Revokes a client portal link immediately — any in-progress OTP or existing session tied to it is rejected on its next check, since portal_verify_otp()/portal_get_session_context() both re-read the link''s own status every time rather than trusting a cached session.';

-- =============================================================================
-- 2. Portal-facing: link lookup, OTP request/verify, session validation
-- =============================================================================

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
  if v_proposal.archived_at is not null or v_proposal.status not in ('ready', 'sent') then
    return query select v_link.id, v_link.tenant_id, v_link.proposal_id, v_tenant.name, v_proposal.title, false, 'unavailable';
    return;
  end if;

  return query select v_link.id, v_link.tenant_id, v_link.proposal_id, v_tenant.name, v_proposal.title, true, 'ok';
end;
$$;

comment on function public.portal_get_link_info(text) is
  'Landing-page lookup for /p/[token] — validates the link (found, not revoked, not expired, proposal still ready/not archived) and returns just enough to render the "Prepared for you by {business}" header before any email is entered. Never returns client email/contact info.';

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

  if not exists (
    select 1 from public.proposals p
    where p.id = v_link.proposal_id and p.archived_at is null and p.status in ('ready', 'sent')
  ) then
    return query select 'invalid_link', false;
    return;
  end if;

  -- Rate limiting (brief: "Max OTP requests por link/email/time window"):
  -- both a per-link cap (defends against enumerating many emails against one
  -- link) and a per-link+email cap (defends against spamming one recipient).
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

  -- A code row is only ever created for an authorized email — an
  -- unauthorized request gets the exact same 'ok' outcome (see the caller,
  -- which always shows the same generic message either way) but nothing is
  -- persisted and no email is ever sent, per the brief's explicit
  -- "no revelar si el email existe."
  if v_matched then
    insert into public.proposal_portal_otps (tenant_id, proposal_id, portal_link_id, client_email, code_hash, expires_at, ip_hash, user_agent_hash)
    values (v_link.tenant_id, v_link.proposal_id, v_link.id, v_email, p_code_hash, p_expires_at, p_ip_hash, p_user_agent_hash);

    perform public.log_audit_event(v_link.tenant_id, null, 'portal_otp.requested', 'proposal_portal_link', v_link.id,
      jsonb_build_object('proposal_id', v_link.proposal_id));
  end if;

  return query select 'ok', v_matched;
end;
$$;

comment on function public.portal_request_otp(text, text, text, timestamptz, text, text) is
  'Requests a one-time code for a portal link. p_code_hash is the SHA-256 hex digest of a raw 6-digit code generated in TS — the raw code is only ever held in memory long enough to email it. email_matched is returned for the CALLER''S internal use only (deciding whether to actually send an email) — the HTTP response shown to the browser must be identical regardless of its value, per the brief''s "no revelar si el email existe."';

create or replace function public.portal_verify_otp(
  p_token_hash text,
  p_email text,
  p_code_hash text,
  p_session_token_hash text,
  p_session_expires_at timestamptz
)
returns table (outcome text, tenant_id uuid, proposal_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.proposal_portal_links;
  v_otp public.proposal_portal_otps;
  v_email text := lower(btrim(p_email));
begin
  select * into v_link from public.proposal_portal_links l where l.token_hash = p_token_hash;
  if not found or v_link.status = 'revoked' or v_link.expires_at <= now() then
    return query select 'invalid_link', null::uuid, null::uuid;
    return;
  end if;

  -- Row-locked: two concurrent verify attempts against the same code must
  -- serialize, so attempt_count increments (and the max_attempts cutoff)
  -- can never be bypassed by racing requests.
  select * into v_otp
    from public.proposal_portal_otps
    where portal_link_id = v_link.id and lower(client_email) = v_email and consumed_at is null
    order by created_at desc
    limit 1
    for update;

  if not found then
    -- Deliberately the same outcome as a genuine wrong code (no code exists
    -- for this link+email — either none was ever requested, or it was
    -- already consumed) — never distinguishable from "wrong code" externally.
    return query select 'wrong_code', null::uuid, null::uuid;
    return;
  end if;

  if v_otp.expires_at <= now() then
    return query select 'expired', null::uuid, null::uuid;
    return;
  end if;

  if v_otp.attempt_count >= v_otp.max_attempts then
    return query select 'too_many_attempts', null::uuid, null::uuid;
    return;
  end if;

  if v_otp.code_hash <> p_code_hash then
    update public.proposal_portal_otps set attempt_count = attempt_count + 1 where id = v_otp.id;
    return query select 'wrong_code', null::uuid, null::uuid;
    return;
  end if;

  update public.proposal_portal_otps set consumed_at = now() where id = v_otp.id;
  update public.proposal_portal_links set last_viewed_at = now() where id = v_link.id;

  insert into public.proposal_portal_sessions (tenant_id, proposal_id, portal_link_id, client_email, session_token_hash, expires_at)
  values (v_link.tenant_id, v_link.proposal_id, v_link.id, v_email, p_session_token_hash, p_session_expires_at);

  perform public.log_audit_event(v_link.tenant_id, null, 'portal_otp.verified', 'proposal_portal_link', v_link.id,
    jsonb_build_object('proposal_id', v_link.proposal_id));

  return query select 'verified', v_link.tenant_id, v_link.proposal_id;
end;
$$;

comment on function public.portal_verify_otp(text, text, text, text, timestamptz) is
  'Verifies a one-time code and, on success, creates a portal session row. p_code_hash/p_session_token_hash are SHA-256 hex digests computed in TS — the raw code and raw session token never reach this function. outcome is one of: verified, invalid_link, wrong_code, expired, too_many_attempts.';

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
  if not found or v_proposal.archived_at is not null or v_proposal.status not in ('ready', 'sent') then
    return query select 'invalid_session', null::uuid, null::uuid, null::uuid;
    return;
  end if;

  -- Fires the contractor-visible "Proposal viewed by client" activity only
  -- on this session's first view, so repeatedly refreshing/reopening the
  -- portal tab doesn't spam the activity feed — every open still gets its
  -- own proposal_view_events row regardless, for a complete audit trail.
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
  'Validates a portal session cookie on every /p/[token]/view load and records a view event. Re-checks the underlying link status and proposal status on every single call — a link revoked or a proposal archived AFTER a session was created immediately blocks further access, since nothing here is cached. Returns just the ids needed to load the proposal (tenant_id/proposal_id/proposal_version_id); the caller loads the actual FullProposal-shaped data via the admin client afterward, exactly as scoped by these three ids.';

-- =============================================================================
-- Grants
-- =============================================================================

revoke execute on function public.create_proposal_portal_link(uuid, uuid, text, timestamptz) from public;
grant execute on function public.create_proposal_portal_link(uuid, uuid, text, timestamptz) to authenticated;

revoke execute on function public.revoke_proposal_portal_link(uuid) from public;
grant execute on function public.revoke_proposal_portal_link(uuid) to authenticated;

-- The four portal-facing functions below are deliberately NEVER granted to
-- `anon` or `authenticated` — they are reachable only via the service-role
-- admin client (which is not subject to these grants at all), called
-- exclusively from src/app/p/[token]/** route handlers/actions. This is the
-- "narrow, auditable, encapsulated" use of the service role documented on
-- src/lib/supabase/admin.ts and required by the brief (section 12): the
-- service role itself is never exposed to the browser, and these functions
-- are the ONLY code path that ever touches proposal_portal_otps/
-- proposal_portal_sessions.
revoke execute on function public.portal_get_link_info(text) from public, anon, authenticated;
revoke execute on function public.portal_request_otp(text, text, text, timestamptz, text, text) from public, anon, authenticated;
revoke execute on function public.portal_verify_otp(text, text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.portal_get_session_context(text, text, text) from public, anon, authenticated;
