-- Phase 3A: Client Portal — fix a real rate-limiting gap in portal_request_otp().
--
-- Bug: the original version (20260715100100) only inserted a
-- proposal_portal_otps row when the submitted email matched the proposal's
-- client/contact email. Since BOTH the per-link and per-link+email rate
-- limit checks count existing proposal_portal_otps rows, an attacker
-- submitting a WRONG email repeatedly (enumerating guesses) never produced
-- a row at all — the exact "many emails against one link" scenario the
-- per-link limit was meant to catch was completely unthrottled.
--
-- Fix: always insert a row (recording the attempt), regardless of match —
-- this is what the rate limit actually needs to count. Only the
-- audit_logs 'portal_otp.requested' entry and the real email send remain
-- conditional on a genuine match; an unmatched row's code_hash is never
-- given to anyone (the caller only emails the code when email_matched is
-- true), so it can never be used to pass portal_verify_otp() regardless of
-- whether the row exists. No behavior change to the caller-visible outcome
-- ('ok' either way) or to the "no revelar si el email existe" guarantee.
--
-- Same signature as the original -- CREATE OR REPLACE is sufficient, no
-- DROP needed (the RETURNS TABLE shape is unchanged).

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

  -- Rate limiting: counts EVERY requested code for this link/link+email,
  -- matched or not -- this is what actually throttles an attacker
  -- enumerating emails against a link (a mismatched email must still count,
  -- or the limit never engages against exactly that attack).
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

  -- Always insert -- an attempt is an attempt, matched or not, and the rate
  -- limit above depends on that. An unmatched row's code_hash is simply
  -- never emailed to anyone (see the caller, requestPortalOtpAction), so it
  -- can never be used to pass portal_verify_otp() either way.
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
  'Requests a one-time code for a portal link. p_code_hash is the SHA-256 hex digest of a raw 6-digit code generated in TS — the raw code is only ever held in memory long enough to email it. A row is inserted for EVERY request, matched or not (needed for the rate limit to actually throttle email enumeration); email_matched is returned for the CALLER''S internal use only (deciding whether to actually send an email) — the HTTP response shown to the browser must be identical regardless of its value, per the brief''s "no revelar si el email existe."';
