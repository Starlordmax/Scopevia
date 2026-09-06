-- Phase 2A: Proposal-centric pivot — proposal_media: the join between a
-- proposal_version and the media it displays, either freshly uploaded
-- ('current_job') or reused from the Portfolio ('previous_work').
--
-- portfolio_project_id is informational only when usage_type='previous_work'
-- (which portfolio item this came from, for the builder's "already added"
-- state) — the actual displayed image is always media_asset_id. Archiving a
-- portfolio_project does NOT cascade here (no FK action), matching the
-- brief's "Archivar Portfolio no debe romper una Proposal existente."

create table public.proposal_media (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  proposal_version_id uuid not null,
  media_asset_id uuid not null,
  portfolio_project_id uuid,
  usage_type text not null check (usage_type in ('current_job', 'previous_work')),
  caption text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, tenant_id),
  unique (proposal_version_id, media_asset_id),
  foreign key (proposal_version_id, tenant_id) references public.proposal_versions (id, tenant_id),
  foreign key (media_asset_id, tenant_id) references public.media_assets (id, tenant_id),
  foreign key (portfolio_project_id, tenant_id) references public.portfolio_projects (id, tenant_id)
);

comment on table public.proposal_media is
  'Which media a proposal_version displays and how (current_job vs previous_work). Mutated exclusively via attach_media_to_proposal()/detach_media_from_proposal(); protected from mutation on a locked version by trg_proposal_media_prevent_locked_mutation, same as sections/labor/line items.';

create index proposal_media_version_idx on public.proposal_media (proposal_version_id, usage_type, sort_order) where archived_at is null;

create trigger trg_proposal_media_prevent_locked_mutation
  before insert or update or delete on public.proposal_media
  for each row execute function public.prevent_locked_version_child_mutation();
