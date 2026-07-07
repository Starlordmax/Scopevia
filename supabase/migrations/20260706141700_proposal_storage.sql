-- Phase 2A: Proposal-centric pivot — private Storage bucket + policies.
--
-- Bucket: scopevia-media, PRIVATE (public = false), 10 MB limit,
-- image/jpeg|png|webp only — enforced by Supabase Storage itself at the
-- bucket level, not just by application code (defense in depth alongside
-- register_media_asset()'s own checks — see docs/33-media-and-storage-security.md).
--
-- Path convention: `<tenant_id>/<media_id>/original.<ext>` — the tenant id
-- is never the user's name/email, always a UUID, so there is nothing
-- personally identifying in the path itself. Policies derive the tenant
-- from the path's first folder segment via storage.foldername() and check
-- it against the caller's own permissions with user_has_permission() — the
-- exact same authorization model as every table in this project, applied to
-- Storage instead of a table's tenant_id column.
--
-- No public URLs are ever generated — the application always requests a
-- short-lived signed URL (see src/lib/storage/*.ts). No DELETE policy is
-- defined: media rows are archived, never hard-deleted, and Storage objects
-- follow the same rule — hard deletion is a manual/future operational task,
-- not a user-facing action.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scopevia-media', 'scopevia-media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Safe UUID parsing: a malformed/manipulated path segment must make a
-- policy evaluate to false (access denied), never raise a hard error that
-- could leak information or produce a confusing 500 instead of a clean deny.
create or replace function public.try_parse_uuid(p_text text)
returns uuid
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  return p_text::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

comment on function public.try_parse_uuid(text) is
  'Parses text as a uuid, returning null instead of raising on invalid input — used by Storage RLS policies to safely derive a tenant id from an object path.';

create policy scopevia_media_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'scopevia-media'
    and public.user_has_permission(public.try_parse_uuid((storage.foldername(name))[1]), 'media.view')
  );

create policy scopevia_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'scopevia-media'
    and public.user_has_permission(public.try_parse_uuid((storage.foldername(name))[1]), 'media.upload')
  );

create policy scopevia_media_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'scopevia-media'
    and public.user_has_permission(public.try_parse_uuid((storage.foldername(name))[1]), 'media.update')
  )
  with check (
    bucket_id = 'scopevia-media'
    and public.user_has_permission(public.try_parse_uuid((storage.foldername(name))[1]), 'media.update')
  );
