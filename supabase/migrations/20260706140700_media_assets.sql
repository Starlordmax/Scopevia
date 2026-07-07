-- Phase 2A: Proposal-centric pivot — media_assets.
--
-- One row per uploaded file, independent of where it's used (a proposal's
-- current-job photos, or a reusable portfolio photo). The Storage object
-- itself lives in the private `scopevia-media` bucket at
-- `tenant-id/media-id/original.ext` (see 20260706141700_proposal_storage.sql)
-- — this row is the metadata/authorization anchor; width/height are
-- client-supplied display hints only (non-authoritative, never used for
-- security decisions) since Phase 2A has no server-side image processing.

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  storage_bucket text not null default 'scopevia-media' check (storage_bucket = 'scopevia-media'),
  storage_path text not null,
  original_filename text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  width int check (width is null or width > 0),
  height int check (height is null or height > 0),
  caption text not null default '',
  media_type text not null check (media_type in ('current_job', 'portfolio', 'general')),
  uploaded_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references auth.users (id),
  unique (id, tenant_id),
  unique (storage_bucket, storage_path)
);

comment on table public.media_assets is
  'Metadata for a file in the private scopevia-media Storage bucket. Rows are created exclusively by register_media_asset() AFTER the object is confirmed to exist in Storage (see docs/33-media-and-storage-security.md) — this table is never the source of truth for whether the file exists, Storage is. Archived (never hard-deleted) if referenced by any proposal_media/portfolio_project_media row.';

create index media_assets_tenant_type_idx on public.media_assets (tenant_id, media_type) where archived_at is null;

create trigger trg_media_assets_set_updated_at
  before update on public.media_assets
  for each row execute function public.set_updated_at();
