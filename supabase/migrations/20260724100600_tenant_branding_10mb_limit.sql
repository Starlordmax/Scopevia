-- Raises the business logo size limit from 2 MB to 10 MB, at every layer
-- that previously enforced 2 MB: the tenant-branding Storage bucket, the
-- tenants.logo_size_bytes CHECK constraint, and update_tenant_branding()'s
-- own re-validation. Matches the app's other already-shipped upload limit
-- (src/lib/storage/media.ts's 10 MB job/portfolio photos) rather than
-- introducing a new, different ceiling.

update storage.buckets
   set file_size_limit = 10485760
 where id = 'tenant-branding';

alter table public.tenants
  drop constraint tenants_logo_size_bytes_check,
  add constraint tenants_logo_size_bytes_check
    check (logo_size_bytes is null or (logo_size_bytes > 0 and logo_size_bytes <= 10485760));

create or replace function public.update_tenant_branding(
  p_tenant_id uuid,
  p_logo_storage_path text,
  p_logo_original_filename text,
  p_logo_content_type text,
  p_logo_size_bytes bigint
)
returns public.tenants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.tenants;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.user_has_permission(p_tenant_id, 'tenant.update') then
    raise exception 'Missing permission: tenant.update' using errcode = '42501';
  end if;

  if p_logo_storage_path is null or btrim(p_logo_storage_path) = '' then
    raise exception 'Logo storage path is required' using errcode = '22023';
  end if;
  if p_logo_storage_path not like (p_tenant_id::text || '/%') then
    raise exception 'Logo storage path must belong to this tenant' using errcode = '22023';
  end if;
  if p_logo_content_type is null or p_logo_content_type not in ('image/png', 'image/jpeg', 'image/webp') then
    raise exception 'Unsupported logo file type' using errcode = '22023';
  end if;
  if p_logo_size_bytes is null or p_logo_size_bytes <= 0 or p_logo_size_bytes > 10485760 then
    raise exception 'Logo file must be between 1 byte and 10 MB' using errcode = '22023';
  end if;

  update public.tenants
     set logo_storage_path = p_logo_storage_path,
         logo_original_filename = nullif(btrim(coalesce(p_logo_original_filename, '')), ''),
         logo_content_type = p_logo_content_type,
         logo_size_bytes = p_logo_size_bytes,
         logo_updated_at = now()
   where id = p_tenant_id
   returning * into v_result;

  if not found then
    raise exception 'Tenant not found' using errcode = 'P0002';
  end if;

  perform public.log_audit_event(p_tenant_id, v_user_id, 'tenant.logo_updated', 'tenants', p_tenant_id, '{}'::jsonb);

  return v_result;
end;
$$;
