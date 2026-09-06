-- Phase 2A: Proposal-centric pivot — media registration, attach/detach, and
-- portfolio CRUD.
--
-- Permission split, deliberately NOT proposals.update for attach/detach
-- (docs/27 of the brief): a Field Worker has media.upload but not
-- proposals.update, and must still be able to add a current-job photo to a
-- proposal without general edit rights. Reusing a portfolio photo requires
-- only portfolio.view (viewing is enough to pick from the gallery).

create or replace function public.register_media_asset(
  p_tenant_id uuid,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_media_type text,
  p_width int default null,
  p_height int default null,
  p_caption text default ''
)
returns public.media_assets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_asset public.media_assets;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.user_has_permission(p_tenant_id, 'media.upload') then
    raise exception 'Missing permission: media.upload' using errcode = '42501';
  end if;

  -- Redundant with the Storage bucket's own MIME/size policies — defense in
  -- depth, never the only check (see docs/33-media-and-storage-security.md).
  if p_mime_type not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'Unsupported file type' using errcode = '22023';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 10485760 then
    raise exception 'File is too large (10 MB maximum)' using errcode = '22023';
  end if;
  if p_media_type not in ('current_job', 'portfolio', 'general') then
    raise exception 'Invalid media type' using errcode = '22023';
  end if;
  -- The storage path must genuinely start with this tenant's id — the
  -- upload itself is also constrained by Storage policy, but registering a
  -- row for a path outside your tenant must fail here too.
  if p_storage_path is null or p_storage_path !~ ('^' || p_tenant_id::text || '/') then
    raise exception 'Storage path does not belong to this tenant' using errcode = '22023';
  end if;

  insert into public.media_assets (
    tenant_id, storage_path, original_filename, mime_type, size_bytes, width, height, caption, media_type, uploaded_by
  )
  values (
    p_tenant_id, p_storage_path, p_original_filename, p_mime_type, p_size_bytes, p_width, p_height,
    coalesce(p_caption, ''), p_media_type, v_user_id
  )
  returning * into v_asset;

  perform public.log_audit_event(p_tenant_id, v_user_id, 'media.uploaded', 'media_asset', v_asset.id,
    jsonb_build_object('media_type', p_media_type, 'size_bytes', p_size_bytes));

  return v_asset;
end;
$$;

comment on function public.register_media_asset(uuid, text, text, text, bigint, text, int, int, text) is
  'Registers metadata for a file already uploaded to the private scopevia-media bucket. Never trusts the browser''s claimed MIME/size beyond this redundant check — Storage''s own policies are the primary control (docs/33-media-and-storage-security.md).';

create or replace function public.attach_media_to_proposal(
  p_proposal_version_id uuid,
  p_media_asset_id uuid,
  p_usage_type text,
  p_portfolio_project_id uuid default null,
  p_caption text default '',
  p_sort_order int default 0
)
returns public.proposal_media
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_version public.proposal_versions;
  v_asset public.media_assets;
  v_result public.proposal_media;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_version from public.proposal_versions where id = p_proposal_version_id;
  if not found then
    raise exception 'Proposal version not found' using errcode = 'P0002';
  end if;

  if p_usage_type not in ('current_job', 'previous_work') then
    raise exception 'Invalid usage type' using errcode = '22023';
  end if;

  if p_usage_type = 'current_job' and not public.user_has_permission(v_version.tenant_id, 'media.upload') then
    raise exception 'Missing permission: media.upload' using errcode = '42501';
  end if;
  if p_usage_type = 'previous_work' and not public.user_has_permission(v_version.tenant_id, 'portfolio.view') then
    raise exception 'Missing permission: portfolio.view' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  select * into v_asset from public.media_assets where id = p_media_asset_id and tenant_id = v_version.tenant_id and archived_at is null;
  if not found then
    raise exception 'Media asset not found in this tenant' using errcode = 'P0002';
  end if;

  if p_portfolio_project_id is not null and not exists (
    select 1 from public.portfolio_projects where id = p_portfolio_project_id and tenant_id = v_version.tenant_id
  ) then
    raise exception 'Portfolio project not found in this tenant' using errcode = 'P0002';
  end if;

  insert into public.proposal_media (
    tenant_id, proposal_version_id, media_asset_id, portfolio_project_id, usage_type, caption, sort_order
  )
  values (
    v_version.tenant_id, p_proposal_version_id, p_media_asset_id, p_portfolio_project_id, p_usage_type,
    coalesce(p_caption, ''), p_sort_order
  )
  on conflict (proposal_version_id, media_asset_id) do update
    set usage_type = excluded.usage_type, caption = excluded.caption, archived_at = null
  returning * into v_result;

  perform public.log_audit_event(v_version.tenant_id, v_user_id, 'proposal.media_attached', 'proposal_media', v_result.id,
    jsonb_build_object('proposal_version_id', p_proposal_version_id, 'usage_type', p_usage_type));

  return v_result;
end;
$$;

create or replace function public.detach_media_from_proposal(p_proposal_media_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.proposal_media;
  v_version public.proposal_versions;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.proposal_media where id = p_proposal_media_id;
  if not found then
    raise exception 'Media attachment not found' using errcode = 'P0002';
  end if;

  select * into v_version from public.proposal_versions where id = v_row.proposal_version_id;

  if v_row.usage_type = 'current_job' and not public.user_has_permission(v_row.tenant_id, 'media.upload') then
    raise exception 'Missing permission: media.upload' using errcode = '42501';
  end if;
  if v_row.usage_type = 'previous_work' and not public.user_has_permission(v_row.tenant_id, 'portfolio.view') then
    raise exception 'Missing permission: portfolio.view' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  -- Removes it from THIS proposal only — never touches the underlying
  -- media_asset or, for previous_work, the Portfolio item itself.
  delete from public.proposal_media where id = p_proposal_media_id;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'proposal.media_detached', 'proposal_media', p_proposal_media_id, '{}'::jsonb);
end;
$$;

-- =============================================================================
-- Portfolio
-- =============================================================================

create or replace function public.create_portfolio_project(
  p_tenant_id uuid,
  p_title text,
  p_service_type text,
  p_description text default '',
  p_location_label text default '',
  p_completed_at date default null
)
returns public.portfolio_projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_project public.portfolio_projects;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.user_has_permission(p_tenant_id, 'portfolio.create') then
    raise exception 'Missing permission: portfolio.create' using errcode = '42501';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'Title is required' using errcode = '22023';
  end if;

  insert into public.portfolio_projects (tenant_id, title, service_type, description, location_label, completed_at, created_by)
  values (p_tenant_id, btrim(p_title), p_service_type, coalesce(p_description, ''), coalesce(p_location_label, ''), p_completed_at, v_user_id)
  returning * into v_project;

  perform public.log_audit_event(p_tenant_id, v_user_id, 'portfolio.created', 'portfolio_project', v_project.id,
    jsonb_build_object('title', v_project.title));

  return v_project;
end;
$$;

create or replace function public.update_portfolio_project(
  p_portfolio_project_id uuid,
  p_title text,
  p_service_type text,
  p_description text,
  p_location_label text,
  p_completed_at date
)
returns public.portfolio_projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.portfolio_projects;
  v_result public.portfolio_projects;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.portfolio_projects where id = p_portfolio_project_id;
  if not found then
    raise exception 'Portfolio project not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'portfolio.update') then
    raise exception 'Missing permission: portfolio.update' using errcode = '42501';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'Title is required' using errcode = '22023';
  end if;

  update public.portfolio_projects
     set title = btrim(p_title), service_type = p_service_type, description = coalesce(p_description, ''),
         location_label = coalesce(p_location_label, ''), completed_at = p_completed_at
   where id = p_portfolio_project_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'portfolio.updated', 'portfolio_project', p_portfolio_project_id, '{}'::jsonb);

  return v_result;
end;
$$;

create or replace function public.archive_portfolio_project(p_portfolio_project_id uuid)
returns public.portfolio_projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.portfolio_projects;
  v_result public.portfolio_projects;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.portfolio_projects where id = p_portfolio_project_id;
  if not found then
    raise exception 'Portfolio project not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'portfolio.archive') then
    raise exception 'Missing permission: portfolio.archive' using errcode = '42501';
  end if;

  if v_row.archived_at is not null then
    return v_row;
  end if;

  update public.portfolio_projects set archived_at = now(), archived_by = v_user_id
   where id = p_portfolio_project_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'portfolio.archived', 'portfolio_project', p_portfolio_project_id, '{}'::jsonb);

  return v_result;
end;
$$;

create or replace function public.restore_portfolio_project(p_portfolio_project_id uuid)
returns public.portfolio_projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.portfolio_projects;
  v_result public.portfolio_projects;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.portfolio_projects where id = p_portfolio_project_id;
  if not found then
    raise exception 'Portfolio project not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'portfolio.restore') then
    raise exception 'Missing permission: portfolio.restore' using errcode = '42501';
  end if;

  if v_row.archived_at is null then
    return v_row;
  end if;

  update public.portfolio_projects set archived_at = null, archived_by = null
   where id = p_portfolio_project_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'portfolio.restored', 'portfolio_project', p_portfolio_project_id, '{}'::jsonb);

  return v_result;
end;
$$;

create or replace function public.add_portfolio_project_media(
  p_portfolio_project_id uuid,
  p_media_asset_id uuid,
  p_caption text default '',
  p_sort_order int default 0
)
returns public.portfolio_project_media
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_project public.portfolio_projects;
  v_asset public.media_assets;
  v_result public.portfolio_project_media;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_project from public.portfolio_projects where id = p_portfolio_project_id;
  if not found then
    raise exception 'Portfolio project not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_project.tenant_id, 'portfolio.update') then
    raise exception 'Missing permission: portfolio.update' using errcode = '42501';
  end if;

  select * into v_asset from public.media_assets where id = p_media_asset_id and tenant_id = v_project.tenant_id and archived_at is null;
  if not found then
    raise exception 'Media asset not found in this tenant' using errcode = 'P0002';
  end if;

  insert into public.portfolio_project_media (tenant_id, portfolio_project_id, media_asset_id, caption, sort_order)
  values (v_project.tenant_id, p_portfolio_project_id, p_media_asset_id, coalesce(p_caption, ''), p_sort_order)
  on conflict (portfolio_project_id, media_asset_id) do update
    set caption = excluded.caption, sort_order = excluded.sort_order
  returning * into v_result;

  return v_result;
end;
$$;

-- =============================================================================
-- Grants
-- =============================================================================

revoke execute on function public.register_media_asset(uuid, text, text, text, bigint, text, int, int, text) from public;
grant execute on function public.register_media_asset(uuid, text, text, text, bigint, text, int, int, text) to authenticated;

revoke execute on function public.attach_media_to_proposal(uuid, uuid, text, uuid, text, int) from public;
grant execute on function public.attach_media_to_proposal(uuid, uuid, text, uuid, text, int) to authenticated;
revoke execute on function public.detach_media_from_proposal(uuid) from public;
grant execute on function public.detach_media_from_proposal(uuid) to authenticated;

revoke execute on function public.create_portfolio_project(uuid, text, text, text, text, date) from public;
grant execute on function public.create_portfolio_project(uuid, text, text, text, text, date) to authenticated;
revoke execute on function public.update_portfolio_project(uuid, text, text, text, text, date) from public;
grant execute on function public.update_portfolio_project(uuid, text, text, text, text, date) to authenticated;
revoke execute on function public.archive_portfolio_project(uuid) from public;
grant execute on function public.archive_portfolio_project(uuid) to authenticated;
revoke execute on function public.restore_portfolio_project(uuid) from public;
grant execute on function public.restore_portfolio_project(uuid) to authenticated;
revoke execute on function public.add_portfolio_project_media(uuid, uuid, text, int) from public;
grant execute on function public.add_portfolio_project_media(uuid, uuid, text, int) to authenticated;
