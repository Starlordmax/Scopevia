-- Phase 1: CRM & Projects — note mutation functions
--
-- Exactly one of p_client_id/p_opportunity_id/p_project_id must be provided —
-- enforced here with a friendly error, and backstopped by
-- crm_notes_exactly_one_parent at the database level regardless of caller.

create or replace function public.create_note(
  p_tenant_id uuid,
  p_body text,
  p_client_id uuid default null,
  p_opportunity_id uuid default null,
  p_project_id uuid default null
)
returns public.crm_notes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_note public.crm_notes;
  v_parent_count int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.user_has_permission(p_tenant_id, 'notes.create') then
    raise exception 'Missing permission: notes.create' using errcode = '42501';
  end if;

  if p_body is null or btrim(p_body) = '' then
    raise exception 'Note body is required' using errcode = '22023';
  end if;

  v_parent_count := (case when p_client_id is not null then 1 else 0 end)
    + (case when p_opportunity_id is not null then 1 else 0 end)
    + (case when p_project_id is not null then 1 else 0 end);
  if v_parent_count <> 1 then
    raise exception 'A note must be attached to exactly one of client/opportunity/project' using errcode = '22023';
  end if;

  if p_client_id is not null and not exists (select 1 from public.clients where id = p_client_id and tenant_id = p_tenant_id) then
    raise exception 'Client not found in this tenant' using errcode = 'P0002';
  end if;
  if p_opportunity_id is not null and not exists (select 1 from public.opportunities where id = p_opportunity_id and tenant_id = p_tenant_id) then
    raise exception 'Opportunity not found in this tenant' using errcode = 'P0002';
  end if;
  if p_project_id is not null and not exists (select 1 from public.projects where id = p_project_id and tenant_id = p_tenant_id) then
    raise exception 'Project not found in this tenant' using errcode = 'P0002';
  end if;

  insert into public.crm_notes (tenant_id, client_id, opportunity_id, project_id, body, created_by)
  values (p_tenant_id, p_client_id, p_opportunity_id, p_project_id, btrim(p_body), v_user_id)
  returning * into v_note;

  perform public.log_audit_event(p_tenant_id, v_user_id, 'note.created', 'crm_note', v_note.id, '{}'::jsonb);
  perform public.log_crm_activity(p_tenant_id, p_client_id, p_opportunity_id, p_project_id, 'note_added', v_user_id, '{}'::jsonb);

  return v_note;
end;
$$;

comment on function public.create_note(uuid, text, uuid, uuid, uuid) is
  'Creates a note attached to exactly one of client/opportunity/project. Also logs a note_added crm_activity against the same parent.';

create or replace function public.update_note(p_note_id uuid, p_body text)
returns public.crm_notes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.crm_notes;
  v_result public.crm_notes;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.crm_notes where id = p_note_id;
  if not found then
    raise exception 'Note not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'notes.update') then
    raise exception 'Missing permission: notes.update' using errcode = '42501';
  end if;

  if v_row.archived_at is not null then
    raise exception 'Cannot edit an archived note' using errcode = '22023';
  end if;

  if p_body is null or btrim(p_body) = '' then
    raise exception 'Note body is required' using errcode = '22023';
  end if;

  update public.crm_notes
     set body = btrim(p_body)
   where id = p_note_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'note.updated', 'crm_note', p_note_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.update_note(uuid, text) is 'Edits a note''s body. Cannot edit an already-archived note.';

create or replace function public.archive_note(p_note_id uuid)
returns public.crm_notes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.crm_notes;
  v_result public.crm_notes;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.crm_notes where id = p_note_id;
  if not found then
    raise exception 'Note not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'notes.archive') then
    raise exception 'Missing permission: notes.archive' using errcode = '42501';
  end if;

  if v_row.archived_at is not null then
    return v_row;
  end if;

  update public.crm_notes
     set archived_at = now(), archived_by = v_user_id
   where id = p_note_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'note.archived', 'crm_note', p_note_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.archive_note(uuid) is 'Archives a note. No restore path in Phase 1 (no notes.restore permission is seeded).';

revoke execute on function public.create_note(uuid, text, uuid, uuid, uuid) from public;
grant execute on function public.create_note(uuid, text, uuid, uuid, uuid) to authenticated;

revoke execute on function public.update_note(uuid, text) from public;
grant execute on function public.update_note(uuid, text) to authenticated;

revoke execute on function public.archive_note(uuid) from public;
grant execute on function public.archive_note(uuid) to authenticated;
