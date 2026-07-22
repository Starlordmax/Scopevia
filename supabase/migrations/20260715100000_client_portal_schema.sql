-- Phase 3A: Client Portal with Email + OTP access — schema.
--
-- Four tables, in the order the portal flow actually uses them. See
-- docs/52-client-portal-foundation.md and docs/53-client-portal-security.md.
--
-- Design decision (docs/53, "Why no auth.uid()-based RLS"): a portal
-- visitor is NOT a Supabase Auth user — there is no session, no auth.uid(),
-- and no tenant membership to check permissions against. Every one of these
-- four tables therefore gets RLS enabled (matching this codebase's
-- "every table has RLS" discipline) but the portal-visitor-facing tables
-- (proposal_portal_otps, proposal_portal_sessions) get ZERO policies —
-- they are reachable only through SECURITY DEFINER functions called via the
-- service-role admin client (src/lib/supabase/admin.ts), which bypasses RLS
-- entirely by design. proposal_portal_links and proposal_view_events additionally
-- get a read-only policy for tenant members, since a contractor legitimately
-- needs to see their own links/view history — see the RLS migration
-- (20260715100200) for the actual policies.
--
-- Security decision (docs/53): the raw link token, the raw 6-digit OTP code,
-- and the raw session token are NEVER sent to Postgres at all — only their
-- SHA-256 hash (computed in TS, src/lib/portal/tokens.ts). This is stronger
-- than hashing inside a SQL function, since the plaintext secret never
-- appears in a query, a query plan, or a database log line.

-- =============================================================================
-- proposal_portal_links — a shareable, revocable, expiring link to one
-- proposal's current version. Created via create_proposal_portal_link(),
-- revoked via revoke_proposal_portal_link() — never updated directly.
-- =============================================================================

create table public.proposal_portal_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  proposal_id uuid not null,
  proposal_version_id uuid not null,
  -- SHA-256 hex digest of the raw token embedded in the /p/[token] URL. The
  -- raw token itself is never stored anywhere, in any form — see header.
  token_hash text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  expires_at timestamptz not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  last_viewed_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id),
  unique (id, tenant_id),
  unique (token_hash),
  foreign key (proposal_id, tenant_id) references public.proposals (id, tenant_id),
  foreign key (proposal_version_id, tenant_id) references public.proposal_versions (id, tenant_id),
  constraint proposal_portal_links_revoked_consistency check (
    (status = 'revoked') = (revoked_at is not null)
  )
);

comment on table public.proposal_portal_links is
  'A shareable client-portal link to one proposal''s current version. Mutated exclusively via create_proposal_portal_link()/revoke_proposal_portal_link(). The raw token is shown to the contractor exactly once, at creation time, and never stored — only token_hash (SHA-256 of the raw token, computed in TS) is persisted.';

create index proposal_portal_links_proposal_id_idx on public.proposal_portal_links (proposal_id, created_at desc);

-- =============================================================================
-- proposal_portal_otps — one row per requested one-time code. A code is
-- single-use (consumed_at), expires quickly, and has a bounded number of
-- verification attempts. Written only via portal_request_otp()/
-- portal_verify_otp() (service-role, no authenticated session involved).
-- =============================================================================

create table public.proposal_portal_otps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  proposal_id uuid not null,
  portal_link_id uuid not null,
  client_email text not null check (btrim(client_email) <> ''),
  -- SHA-256 hex digest of the raw 6-digit code. The raw code is only ever
  -- held in memory just long enough to email it — never persisted.
  code_hash text not null,
  expires_at timestamptz not null,
  attempt_count int not null default 0 check (attempt_count >= 0),
  max_attempts int not null default 5 check (max_attempts > 0),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  -- SHA-256 hash of the requester's IP/user-agent — never the raw value
  -- (brief: "No guardar IP cruda si no es necesario"). Used only for abuse
  -- investigation (e.g. "did the same IP request codes for 10 different
  -- emails"), never displayed anywhere in the app.
  ip_hash text,
  user_agent_hash text,
  unique (id, tenant_id),
  foreign key (proposal_id, tenant_id) references public.proposals (id, tenant_id),
  foreign key (portal_link_id, tenant_id) references public.proposal_portal_links (id, tenant_id)
);

comment on table public.proposal_portal_otps is
  'One-time access codes for the client portal. Written only via portal_request_otp() (insert) and portal_verify_otp() (attempt_count/consumed_at update) — both SECURITY DEFINER, both callable only through the service-role admin client, since a portal visitor has no Supabase Auth session to run RLS against. No SELECT/INSERT/UPDATE policy exists for authenticated or anon (see 20260715100200) — this table is invisible to every ordinary client.';

-- Rate limiting: "how many codes has this link/this email requested
-- recently" (portal_request_otp) and "what is the latest unconsumed code
-- for this link+email" (portal_verify_otp) are both served by this one index.
create index proposal_portal_otps_link_email_created_idx
  on public.proposal_portal_otps (portal_link_id, lower(client_email), created_at desc);
create index proposal_portal_otps_ip_hash_idx
  on public.proposal_portal_otps (ip_hash, created_at desc) where ip_hash is not null;

-- =============================================================================
-- proposal_portal_sessions — created the instant an OTP is verified. The
-- raw session token lives only in an httpOnly cookie; only its hash is
-- stored here. No Supabase Auth user is ever created for a client.
-- =============================================================================

create table public.proposal_portal_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  proposal_id uuid not null,
  portal_link_id uuid not null,
  client_email text not null check (btrim(client_email) <> ''),
  session_token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (id, tenant_id),
  unique (session_token_hash),
  foreign key (proposal_id, tenant_id) references public.proposals (id, tenant_id),
  foreign key (portal_link_id, tenant_id) references public.proposal_portal_links (id, tenant_id)
);

comment on table public.proposal_portal_sessions is
  'A verified client portal session (created by portal_verify_otp()). The raw session token lives only in an httpOnly, sameSite=lax cookie on the visitor''s browser — session_token_hash (SHA-256) is all that is ever persisted. No SELECT/INSERT/UPDATE policy exists for authenticated or anon — reachable only via SECURITY DEFINER functions through the service-role admin client.';

create index proposal_portal_sessions_portal_link_id_idx on public.proposal_portal_sessions (portal_link_id);

-- =============================================================================
-- proposal_view_events — append-only record of "this proposal was opened
-- in the portal at this time by this verified client". Never updated or
-- deleted, same discipline as audit_logs/crm_activities.
-- =============================================================================

create table public.proposal_view_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  proposal_id uuid not null,
  proposal_version_id uuid not null,
  portal_link_id uuid not null,
  client_email text not null,
  viewed_at timestamptz not null default now(),
  ip_hash text,
  user_agent_hash text,
  foreign key (proposal_id, tenant_id) references public.proposals (id, tenant_id),
  foreign key (proposal_version_id, tenant_id) references public.proposal_versions (id, tenant_id),
  foreign key (portal_link_id, tenant_id) references public.proposal_portal_links (id, tenant_id)
);

comment on table public.proposal_view_events is
  'Append-only "client opened this proposal" log, one row per portal view. Inserted only by portal_get_session_context(). Not shown to the client themselves (brief: "No exponer eventos al cliente") — surfaced to the contractor only as a "Proposal viewed by client" CRM activity (first view of a session only, to avoid activity-feed spam from repeated refreshes) and, optionally, a raw list on the proposal detail page.';

create index proposal_view_events_proposal_id_idx on public.proposal_view_events (proposal_id, viewed_at desc);

create or replace function public.prevent_view_event_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'proposal_view_events is append-only: % is not permitted', tg_op;
end;
$$;

create trigger trg_proposal_view_events_no_update
  before update on public.proposal_view_events
  for each row execute function public.prevent_view_event_mutation();

create trigger trg_proposal_view_events_no_delete
  before delete on public.proposal_view_events
  for each row execute function public.prevent_view_event_mutation();

-- =============================================================================
-- Extend crm_activities.activity_type with the three new portal-facing
-- events. Same defensive drop pattern as 20260706140000_opportunity_proposal_prep.sql.
-- =============================================================================

do $$
begin
  begin
    alter table public.crm_activities drop constraint crm_activities_activity_type_check;
  exception when undefined_object then
    execute (
      select format('alter table public.crm_activities drop constraint %I', conname)
      from pg_constraint
      where conrelid = 'public.crm_activities'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%activity_type = ANY%'
      limit 1
    );
  end;
end $$;

alter table public.crm_activities add constraint crm_activities_activity_type_check check (activity_type in (
  'note_added', 'call_logged', 'email_logged', 'meeting_logged',
  'inspection_scheduled', 'status_changed',
  'client_created', 'client_archived', 'client_restored',
  'contact_created', 'contact_primary_changed', 'contact_archived', 'contact_restored',
  'opportunity_created', 'opportunity_won', 'opportunity_lost',
  'opportunity_archived', 'opportunity_restored', 'opportunity_converted_to_project',
  'project_created', 'project_archived', 'project_restored',
  'address_primary_changed',
  'proposal_created', 'proposal_marked_ready', 'proposal_returned_to_draft',
  'proposal_archived', 'proposal_restored', 'proposal_media_attached',
  'portfolio_project_attached',
  'client_portal_link_created', 'client_portal_link_revoked', 'proposal_viewed_by_client'
));
