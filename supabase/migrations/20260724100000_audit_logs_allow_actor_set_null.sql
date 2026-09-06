-- Fix: audit_logs' own append-only trigger was blocking the legitimate
-- ON DELETE SET NULL cascade from auth.users.actor_user_id, defeating the
-- table's own documented design intent ("deleting a user's account can
-- never be blocked by... their audit history" — see
-- 20260701120600_audit_logs.sql). Postgres implements ON DELETE SET NULL
-- as an internal UPDATE, which the previous unconditional
-- `raise exception` on every UPDATE was rejecting outright.
--
-- Narrow fix: allow an UPDATE ONLY when it is EXACTLY that cascade shape —
-- actor_user_id going from non-null to null, with every other column
-- byte-for-byte unchanged. Any other UPDATE (including one that also nulls
-- actor_user_id but touches a second column) is still rejected. DELETE
-- remains unconditionally blocked — this migration does not touch tenant
-- deletion (tenant_id's own ON DELETE CASCADE), which stays out of scope.

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'audit_logs is append-only: DELETE is not permitted';
  end if;

  -- tg_op = 'UPDATE' from here on.
  if old.actor_user_id is not null
     and new.actor_user_id is null
     and new.id is not distinct from old.id
     and new.tenant_id is not distinct from old.tenant_id
     and new.action is not distinct from old.action
     and new.entity_type is not distinct from old.entity_type
     and new.entity_id is not distinct from old.entity_id
     and new.metadata is not distinct from old.metadata
     and new.ip_address is not distinct from old.ip_address
     and new.user_agent is not distinct from old.user_agent
     and new.created_at is not distinct from old.created_at
  then
    return new;
  end if;

  raise exception 'audit_logs is append-only: UPDATE is not permitted';
end;
$$;

comment on function public.prevent_audit_log_mutation() is
  'Defense in depth: blocks UPDATE/DELETE on audit_logs even for roles that bypass RLS (e.g. table owner, service_role using raw SQL) -- EXCEPT the single legitimate case of actor_user_id being nulled by auth.users'' own ON DELETE SET NULL cascade, which this function detects by shape (actor_user_id null <- non-null, nothing else changed) and allows through.';
