-- Phase 3D: Email Notifications for Client Portal Events — schema.
--
-- proposal_notification_deliveries is a delivery LOG, not a queue: one row
-- per (event, recipient) attempt, written by the TypeScript notification
-- module (src/lib/notifications/proposals.ts) via the service-role admin
-- client — never by a trigger, and never by an ordinary authenticated
-- write (no insert/update policy is granted below, matching every other
-- portal-adjacent table in this codebase). Its `unique (dedupe_key)`
-- constraint IS the entire duplicate-email guard: the notification module
-- always INSERTs first (status='pending') and only actually sends the
-- email if that insert succeeds; a unique_violation means "already
-- attempted," and the send is skipped — see docs/63-notification-delivery-security.md.
create table public.proposal_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  proposal_id uuid not null,
  proposal_version_id uuid not null,
  event_type text not null check (event_type in (
    'proposal_viewed', 'proposal_accepted', 'proposal_declined',
    'accepted_confirmation_to_client', 'declined_confirmation_to_client'
  )),
  recipient_email text not null check (btrim(recipient_email) <> ''),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  provider text not null check (provider in ('dev', 'resend', 'sendgrid', 'smtp')),
  -- Short, pre-sanitized classification only (e.g. an existing controlled
  -- error message from src/lib/email/*, already stripped of API keys/raw
  -- provider response bodies at the source) — never a raw exception/stack
  -- trace. See docs/63, "What error_code is (and is not)."
  error_code text check (error_code is null or length(error_code) <= 200),
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  unique (id, tenant_id),
  unique (dedupe_key),
  foreign key (proposal_id, tenant_id) references public.proposals (id, tenant_id),
  foreign key (proposal_version_id, tenant_id) references public.proposal_versions (id, tenant_id)
);

comment on table public.proposal_notification_deliveries is
  'Delivery log for contractor/client email notifications about Client Portal events (Phase 3D). Written exclusively via the service-role admin client from src/lib/notifications/proposals.ts. dedupe_key (event_type:proposal_version_id:recipient_email, lowercased) is the sole duplicate-send guard. No raw provider response, no API keys, no OTP codes, no tokens are ever stored here — see docs/63-notification-delivery-security.md.';

create index proposal_notification_deliveries_tenant_idx on public.proposal_notification_deliveries (tenant_id, created_at desc);
create index proposal_notification_deliveries_proposal_idx on public.proposal_notification_deliveries (proposal_id);

-- RLS: readable only by an internal tenant member with audit.view (the
-- same permission that already gates the security-focused audit_logs
-- view — this table is fundamentally the same kind of thing, a delivery/
-- debugging trail, not a new permission domain). No insert/update/delete
-- policy at all — every write goes through the service-role admin client,
-- which bypasses RLS entirely, exactly like proposal_portal_otps/
-- proposal_portal_sessions since Phase 3A. No client portal (anonymous
-- visitor) access of any kind.
alter table public.proposal_notification_deliveries enable row level security;

create policy proposal_notification_deliveries_select on public.proposal_notification_deliveries
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'audit.view'));

grant select on public.proposal_notification_deliveries to authenticated;
