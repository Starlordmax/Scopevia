-- Phase 1: CRM & Projects — crm_notes & crm_activities
--
-- Design decision (see docs/adr/0008-crm-notes-and-activity-model.md): ONE shared
-- `crm_notes` table and ONE shared `crm_activities` table, each using an "exclusive
-- arc" of nullable, individually-composite-FK'd columns (client_id / opportunity_id /
-- project_id) rather than:
--   (a) three near-duplicate per-entity tables (client_notes/opportunity_notes/
--       project_notes) — real integrity, but triples the schema/RLS/function
--       surface for identical behavior, or
--   (b) a generic `entity_type text + entity_id uuid` polymorphic pair — no FK can
--       reference "one of several tables" in Postgres, so this would have ZERO
--       declarative referential integrity (exactly what the brief warns against).
-- A composite FK with MATCH SIMPLE (Postgres's default) is automatically satisfied
-- (not checked) whenever the referencing column is NULL, so having client_id/
-- opportunity_id/project_id all nullable, each with its own composite FK, gives real
-- enforced integrity for whichever one is actually set, with no custom trigger code.
--
-- crm_notes are human-authored, mutable, archivable. crm_activities are
-- system-generated, immutable (append-only, like audit_logs), and are a *business*
-- timeline — never to be confused with the security audit_logs table (see
-- docs/20-phase-1-crm-and-projects.md, "Notes vs. activity vs. audit_logs").

create table public.crm_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  client_id uuid,
  opportunity_id uuid,
  project_id uuid,
  body text not null check (btrim(body) <> ''),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references auth.users (id),
  foreign key (client_id, tenant_id) references public.clients (id, tenant_id),
  foreign key (opportunity_id, tenant_id) references public.opportunities (id, tenant_id),
  foreign key (project_id, tenant_id) references public.projects (id, tenant_id),
  constraint crm_notes_exactly_one_parent check (
    (case when client_id is not null then 1 else 0 end
     + case when opportunity_id is not null then 1 else 0 end
     + case when project_id is not null then 1 else 0 end) = 1
  )
);

comment on table public.crm_notes is
  'Human-authored notes attached to exactly one of client/opportunity/project (exclusive-arc pattern — see migration header). Mutated exclusively via create_note()/update_note()/archive_note(). No restore: archiving a note is a lightweight, low-stakes action with no seeded `notes.restore` permission in Phase 1.';

create index crm_notes_client_id_idx on public.crm_notes (client_id) where client_id is not null and archived_at is null;
create index crm_notes_opportunity_id_idx on public.crm_notes (opportunity_id) where opportunity_id is not null and archived_at is null;
create index crm_notes_project_id_idx on public.crm_notes (project_id) where project_id is not null and archived_at is null;

create trigger trg_crm_notes_set_updated_at
  before update on public.crm_notes
  for each row execute function public.set_updated_at();

-- =============================================================================

create table public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  client_id uuid,
  opportunity_id uuid,
  project_id uuid,
  activity_type text not null check (activity_type in (
    'note_added', 'call_logged', 'email_logged', 'meeting_logged',
    'inspection_scheduled', 'status_changed',
    'client_created', 'client_archived', 'client_restored',
    'contact_created', 'contact_primary_changed', 'contact_archived', 'contact_restored',
    'opportunity_created', 'opportunity_won', 'opportunity_lost',
    'opportunity_archived', 'opportunity_restored', 'opportunity_converted_to_project',
    'project_created', 'project_archived', 'project_restored',
    'address_primary_changed'
  )),
  -- Nullable: reserved for a future system-originated activity with no human actor
  -- (none exist in Phase 1, but the shape matches audit_logs.actor_user_id for
  -- consistency).
  actor_user_id uuid references auth.users (id),
  -- Structured, non-sensitive descriptive data only (e.g. {"from_status": "new",
  -- "to_status": "contacted"}) — never passwords/tokens/secrets/full payloads.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (client_id, tenant_id) references public.clients (id, tenant_id),
  foreign key (opportunity_id, tenant_id) references public.opportunities (id, tenant_id),
  foreign key (project_id, tenant_id) references public.projects (id, tenant_id),
  constraint crm_activities_at_least_one_parent check (
    client_id is not null or opportunity_id is not null or project_id is not null
  )
);

comment on table public.crm_activities is
  'Append-only, system-generated business timeline — separate from the security-focused audit_logs table. Inserted only via log_crm_activity(), called internally by the various create_*/update_*/change_*_status()/archive_*/restore_*/convert_* functions. Never mutated after insert.';

create index crm_activities_client_id_idx on public.crm_activities (client_id, created_at desc) where client_id is not null;
create index crm_activities_opportunity_id_idx on public.crm_activities (opportunity_id, created_at desc) where opportunity_id is not null;
create index crm_activities_project_id_idx on public.crm_activities (project_id, created_at desc) where project_id is not null;

create or replace function public.prevent_crm_activity_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'crm_activities is append-only: % is not permitted', tg_op;
end;
$$;

create trigger trg_crm_activities_no_update
  before update on public.crm_activities
  for each row execute function public.prevent_crm_activity_mutation();

create trigger trg_crm_activities_no_delete
  before delete on public.crm_activities
  for each row execute function public.prevent_crm_activity_mutation();
