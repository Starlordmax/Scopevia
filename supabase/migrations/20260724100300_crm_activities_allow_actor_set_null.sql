-- Same problem as audit_logs (20260724100000), same fix, applied to
-- crm_activities' own append-only trigger: it was unconditionally
-- rejecting every UPDATE, including the legitimate ON DELETE SET NULL
-- cascade from auth.users.actor_user_id (added in 20260724100100), which
-- Postgres implements internally as an UPDATE.

create or replace function public.prevent_crm_activity_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'crm_activities is append-only: DELETE is not permitted';
  end if;

  -- tg_op = 'UPDATE' from here on. Allow only the exact SET NULL cascade
  -- shape: actor_user_id going non-null -> null, nothing else changed.
  if old.actor_user_id is not null
     and new.actor_user_id is null
     and new.id is not distinct from old.id
     and new.tenant_id is not distinct from old.tenant_id
     and new.client_id is not distinct from old.client_id
     and new.opportunity_id is not distinct from old.opportunity_id
     and new.project_id is not distinct from old.project_id
     and new.activity_type is not distinct from old.activity_type
     and new.metadata is not distinct from old.metadata
     and new.created_at is not distinct from old.created_at
  then
    return new;
  end if;

  raise exception 'crm_activities is append-only: UPDATE is not permitted';
end;
$$;
