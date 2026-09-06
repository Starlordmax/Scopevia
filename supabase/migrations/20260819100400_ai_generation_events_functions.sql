-- AI-assisted proposal text — ai_generation_events RPCs: a rate-limit
-- check and an event-recording insert, both permission-checked on
-- ai.generate_proposal_text (see 20260819100500_seed_ai_permissions.sql,
-- which runs after this file despite the lower timestamp gap being
-- intentional -- Postgres doesn't care about forward references to a
-- permission key that doesn't exist as a row yet, since
-- user_has_permission() just returns false for an unknown key until the
-- seed migration inserts it).

create or replace function public.count_recent_ai_generations(p_tenant_id uuid, p_window_minutes int default 60)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_count int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.user_has_permission(p_tenant_id, 'ai.generate_proposal_text') then
    raise exception 'Missing permission: ai.generate_proposal_text' using errcode = '42501';
  end if;

  select count(*) into v_count
    from public.ai_generation_events
   where tenant_id = p_tenant_id
     and user_id = v_user_id
     and created_at > now() - make_interval(mins => p_window_minutes);

  return v_count;
end;
$$;

comment on function public.count_recent_ai_generations(uuid, int) is
  'Per-user, per-tenant count of AI generations in the last p_window_minutes (default 60) -- called by the Server Action BEFORE calling OpenRouter, so a rate-limited user never incurs a provider call at all.';

create or replace function public.record_ai_generation_event(
  p_tenant_id uuid,
  p_proposal_id uuid,
  p_proposal_version_id uuid,
  p_feature text,
  p_model text,
  p_status text,
  p_error_code text default null,
  p_input_tokens int default null,
  p_output_tokens int default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.user_has_permission(p_tenant_id, 'ai.generate_proposal_text') then
    raise exception 'Missing permission: ai.generate_proposal_text' using errcode = '42501';
  end if;

  if p_feature not in ('terms', 'exclusions', 'client_notes', 'all') then
    raise exception 'Invalid feature' using errcode = '22023';
  end if;
  if p_status not in ('success', 'error') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;

  insert into public.ai_generation_events (
    tenant_id, user_id, proposal_id, proposal_version_id, feature, model, status, error_code, input_tokens, output_tokens
  ) values (
    p_tenant_id, v_user_id, p_proposal_id, p_proposal_version_id, p_feature, p_model, p_status, p_error_code, p_input_tokens, p_output_tokens
  )
  returning id into v_id;

  perform public.log_audit_event(
    p_tenant_id, v_user_id, 'ai.proposal_text_generated', 'proposal_versions', p_proposal_version_id,
    jsonb_build_object('feature', p_feature, 'status', p_status)
  );

  return v_id;
end;
$$;

comment on function public.record_ai_generation_event(uuid, uuid, uuid, text, text, text, text, int, int) is
  'Records one AI generation attempt (success or error) for rate limiting and cost observability. Never stores the prompt or raw AI response -- callers pass only a short model name, status, sanitized error_code, and token counts. Also writes a matching audit_logs row for the tenant-wide audit trail.';

revoke execute on function public.count_recent_ai_generations(uuid, int) from public;
grant execute on function public.count_recent_ai_generations(uuid, int) to authenticated;

revoke execute on function public.record_ai_generation_event(uuid, uuid, uuid, text, text, text, text, int, int) from public;
grant execute on function public.record_ai_generation_event(uuid, uuid, uuid, text, text, text, text, int, int) to authenticated;
