-- Phase 3B: Client Portal Accept/Decline — schema.
--
-- One row per FINAL client decision on one proposal_version_id. The
-- `unique (proposal_version_id)` constraint below is the entire "no
-- conflicting responses" guarantee — it makes a second response for the
-- same version a plain 23505 unique violation, atomically, regardless of
-- which portal link/session attempts it. See docs/57-client-response-security.md.
--
-- Append-only, same discipline as audit_logs/crm_activities/proposal_view_events
-- — a client's decision is a historical record, never edited or deleted.

create table public.proposal_client_responses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  proposal_id uuid not null,
  proposal_version_id uuid not null,
  portal_link_id uuid not null,
  portal_session_id uuid not null,
  client_email text not null check (btrim(client_email) <> ''),
  client_name text,
  response_type text not null check (response_type in ('accepted', 'declined')),
  decline_reason text,
  accepted_terms boolean not null default false,
  responded_at timestamptz not null default now(),
  ip_hash text,
  user_agent_hash text,
  created_at timestamptz not null default now(),
  unique (id, tenant_id),
  -- The core guarantee: at most one response, ever, per version.
  unique (proposal_version_id),
  foreign key (proposal_id, tenant_id) references public.proposals (id, tenant_id),
  foreign key (proposal_version_id, tenant_id) references public.proposal_versions (id, tenant_id),
  foreign key (portal_link_id, tenant_id) references public.proposal_portal_links (id, tenant_id),
  foreign key (portal_session_id, tenant_id) references public.proposal_portal_sessions (id, tenant_id),
  constraint proposal_client_responses_accepted_terms_check check (
    response_type = 'declined' or accepted_terms = true
  ),
  constraint proposal_client_responses_client_name_check check (
    response_type = 'declined' or (client_name is not null and btrim(client_name) <> '')
  )
);

comment on table public.proposal_client_responses is
  'A client''s final accept/decline decision on one proposal_version_id (Phase 3B). Inserted only via submit_proposal_client_response() (SECURITY DEFINER, service-role only — see docs/57). The unique(proposal_version_id) constraint is the sole duplicate-response guard: a second insert for an already-responded version fails with 23505, caught by the function and reported as "already_responded" regardless of which link/session attempts it. Append-only — never updated or deleted.';

create index proposal_client_responses_proposal_id_idx on public.proposal_client_responses (proposal_id);
create index proposal_client_responses_portal_link_id_idx on public.proposal_client_responses (portal_link_id);

create or replace function public.prevent_client_response_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'proposal_client_responses is append-only: % is not permitted', tg_op;
end;
$$;

create trigger trg_proposal_client_responses_no_update
  before update on public.proposal_client_responses
  for each row execute function public.prevent_client_response_mutation();

create trigger trg_proposal_client_responses_no_delete
  before delete on public.proposal_client_responses
  for each row execute function public.prevent_client_response_mutation();

-- =============================================================================
-- Extend crm_activities.activity_type with the two new client-response
-- events. Same defensive drop pattern as 20260706140000/20260715100000.
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
  'client_portal_link_created', 'client_portal_link_revoked', 'proposal_viewed_by_client',
  'proposal_accepted_by_client', 'proposal_declined_by_client'
));
