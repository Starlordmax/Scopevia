-- Phase 2A: Proposal-centric pivot — proposal_sections (Scope of Work).
-- Archived (not hard-deleted) so a removed section doesn't break history on
-- an already-referenced proposal_line_items.section_id.

create table public.proposal_sections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  proposal_version_id uuid not null,
  title text not null check (btrim(title) <> ''),
  description text not null default '',
  section_type text not null default 'custom' check (section_type in (
    'scope', 'schedule', 'materials', 'additional_services', 'exclusions', 'custom'
  )),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, tenant_id),
  foreign key (proposal_version_id, tenant_id) references public.proposal_versions (id, tenant_id)
);

comment on table public.proposal_sections is
  'Scope-of-work sections within a proposal_version. Mutated exclusively via add_proposal_section()/update_proposal_section()/reorder_proposal_sections(); locked-version children are protected by trg_proposal_sections_prevent_locked_mutation.';

create index proposal_sections_version_idx on public.proposal_sections (proposal_version_id, sort_order) where archived_at is null;

create trigger trg_proposal_sections_set_updated_at
  before update on public.proposal_sections
  for each row execute function public.set_updated_at();

create trigger trg_proposal_sections_prevent_locked_mutation
  before insert or update or delete on public.proposal_sections
  for each row execute function public.prevent_locked_version_child_mutation();
