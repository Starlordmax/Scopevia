-- Phase 3D.2: Business logo upload — private Storage bucket + policies.
--
-- Bucket: tenant-branding, PRIVATE (public = false), 2 MB limit,
-- image/png|jpeg|webp only (SVG deliberately excluded for MVP to avoid
-- script/content-injection risk — see docs/70-logo-storage-security.md).
-- Deliberately a SEPARATE bucket from scopevia-media: a business logo is a
-- singular, tenant-identity asset with its own (stricter) size limit and
-- its own permission model (tenant.view / tenant.update, reused from Phase
-- 0 rather than inventing business_branding.* — see docs/69), not another
-- item in the proposal-photos gallery.
--
-- Path convention: `<tenant_id>/logo-<uuid>.<ext>` — same
-- tenant-id-is-the-first-folder-segment convention as scopevia-media, so
-- the same storage.foldername()-based policy shape applies unchanged.
--
-- Unlike scopevia-media (which never hard-deletes Storage objects), this
-- bucket DOES need a DELETE policy: replacing or removing a logo must be
-- able to clean up the previous object so repeated replacement doesn't
-- accumulate orphaned files (see uploadBusinessLogo()/removeBusinessLogo()
-- in src/actions/branding.ts, which always delete the old object only
-- after the new DB pointer write succeeds).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-branding', 'tenant-branding', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

create policy tenant_branding_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'tenant-branding'
    and public.user_has_permission(public.try_parse_uuid((storage.foldername(name))[1]), 'tenant.view')
  );

create policy tenant_branding_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tenant-branding'
    and public.user_has_permission(public.try_parse_uuid((storage.foldername(name))[1]), 'tenant.update')
  );

create policy tenant_branding_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'tenant-branding'
    and public.user_has_permission(public.try_parse_uuid((storage.foldername(name))[1]), 'tenant.update')
  )
  with check (
    bucket_id = 'tenant-branding'
    and public.user_has_permission(public.try_parse_uuid((storage.foldername(name))[1]), 'tenant.update')
  );

create policy tenant_branding_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'tenant-branding'
    and public.user_has_permission(public.try_parse_uuid((storage.foldername(name))[1]), 'tenant.update')
  );
