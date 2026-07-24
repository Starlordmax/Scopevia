-- Phase 3D.2: Business logo upload — branding columns on `tenants`.
--
-- The logo belongs to the BUSINESS (the tenant), never to an individual
-- user's profile — a tenant can have many users, and every proposal from
-- that tenant must render the same logo regardless of who is viewing it.
-- `tenants` is already the tenant's own business record (`tenants.name` is
-- the existing business-name source used everywhere today), so branding is
-- added directly to it rather than inventing a new 1:1 settings table —
-- there is no "defaults that get lazily created" behavior here the way
-- tenant_proposal_settings has, just a handful of nullable columns that
-- describe whether a logo exists and where it lives.
--
-- Only the private Storage path is ever persisted — never base64 image
-- data, never a signed URL (signed URLs are short-lived and generated
-- on demand server-side, see src/lib/storage/branding.ts).

alter table public.tenants
  add column logo_storage_path text,
  add column logo_original_filename text,
  add column logo_content_type text,
  add column logo_size_bytes bigint,
  add column logo_updated_at timestamptz;

alter table public.tenants
  add constraint tenants_logo_content_type_check
    check (logo_content_type is null or logo_content_type in ('image/png', 'image/jpeg', 'image/webp'));

alter table public.tenants
  add constraint tenants_logo_size_bytes_check
    check (logo_size_bytes is null or (logo_size_bytes > 0 and logo_size_bytes <= 2097152));

-- All five columns are null together (no logo) or set together (has a
-- logo) — enforced by update_tenant_branding()/remove_tenant_branding()
-- always writing/clearing them as a unit, not by a DB constraint, since a
-- partial-null state isn't reachable through those functions and a CHECK
-- across 5 nullable columns would be needlessly rigid for future changes.
comment on column public.tenants.logo_storage_path is
  'Private Storage path in the tenant-branding bucket, e.g. "<tenant_id>/logo-<uuid>.png". Never a public/signed URL.';
comment on column public.tenants.logo_updated_at is
  'Set whenever the logo is uploaded or replaced; cleared (null) when removed.';
