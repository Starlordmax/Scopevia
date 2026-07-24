-- Phase 3D.2: Business logo upload — permission-checked branding functions.
-- Reuses the existing tenant.view / tenant.update permissions (Phase 0) —
-- owner and admin already have tenant.update, every other role already has
-- tenant.view only, which is exactly the intended "Owner/Admin can change
-- the logo, everyone else can only see it" matrix — no new permission keys
-- needed.

create or replace function public.get_tenant_branding(p_tenant_id uuid)
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

  if not public.user_has_permission(p_tenant_id, 'tenant.view') then
    raise exception 'Missing permission: tenant.view' using errcode = '42501';
  end if;

  select * into v_result from public.tenants where id = p_tenant_id;
  if not found then
    raise exception 'Tenant not found' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

comment on function public.get_tenant_branding(uuid) is
  'Permission-checked read of a tenant''s branding columns (and the rest of the tenants row). The caller (getBusinessBranding()) only ever surfaces the branding fields — a signed URL, never the raw storage path.';

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
  if p_logo_size_bytes is null or p_logo_size_bytes <= 0 or p_logo_size_bytes > 2097152 then
    raise exception 'Logo file must be between 1 byte and 2 MB' using errcode = '22023';
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

comment on function public.update_tenant_branding(uuid, text, text, text, bigint) is
  'Saves the new logo Storage path on the tenant row. Called AFTER the new file has already been uploaded to Storage — the caller (uploadBusinessLogo()) is responsible for deleting the previous Storage object once this succeeds, and for deleting the newly-uploaded object if this fails.';

create or replace function public.remove_tenant_branding(p_tenant_id uuid)
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

  update public.tenants
     set logo_storage_path = null,
         logo_original_filename = null,
         logo_content_type = null,
         logo_size_bytes = null,
         logo_updated_at = null
   where id = p_tenant_id
   returning * into v_result;

  if not found then
    raise exception 'Tenant not found' using errcode = 'P0002';
  end if;

  perform public.log_audit_event(p_tenant_id, v_user_id, 'tenant.logo_removed', 'tenants', p_tenant_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.remove_tenant_branding(uuid) is
  'Clears the tenant''s logo columns. The caller (removeBusinessLogo()) reads the old storage path BEFORE calling this, then deletes that Storage object after this succeeds.';

revoke execute on function public.get_tenant_branding(uuid) from public;
grant execute on function public.get_tenant_branding(uuid) to authenticated;

revoke execute on function public.update_tenant_branding(uuid, text, text, text, bigint) from public;
grant execute on function public.update_tenant_branding(uuid, text, text, text, bigint) to authenticated;

revoke execute on function public.remove_tenant_branding(uuid) from public;
grant execute on function public.remove_tenant_branding(uuid) to authenticated;
