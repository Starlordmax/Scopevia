-- Phase 0: Foundations
-- Authorization helpers and the transactional tenant/membership API.
--
-- Every SECURITY DEFINER function below:
--   * sets `search_path` explicitly to prevent search_path hijacking,
--   * derives the acting user from auth.uid() (the JWT claim of the calling
--     session) and NEVER accepts a user_id parameter as a source of authority,
--   * has EXECUTE revoked from PUBLIC and granted only to the `authenticated`
--     role (see grants at the bottom of this file and in the RLS migration).

-- =============================================================================
-- 1. Profile provisioning trigger (auth.users -> public.profiles)
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'avatar_url', '')), '')
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  -- Provisioning the profile must never block account creation. If this ever
  -- fails, the application layer defensively upserts the profile on first
  -- authenticated request (see src/lib/auth/session.ts).
  raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates the public.profiles row when a new auth.users row is inserted. Tolerant of missing metadata; never blocks signup.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- 2. RLS helper functions (used inside policies AND application code)
-- =============================================================================

create or replace function public.user_is_active_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tenant_memberships tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  );
$$;

comment on function public.user_is_active_tenant_member(uuid) is
  'True if the CALLING user (auth.uid()) has an active membership in p_tenant_id. SECURITY DEFINER so it can be safely used inside RLS policies on tenant_memberships without recursive-policy evaluation.';

create or replace function public.user_has_permission(p_tenant_id uuid, p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tenant_memberships tm
    join public.role_permissions rp on rp.role_id = tm.role_id
    join public.permissions p on p.id = rp.permission_id
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and p.key = p_permission_key
  );
$$;

comment on function public.user_has_permission(uuid, text) is
  'True if the CALLING user (auth.uid()) holds a permission (by key) in p_tenant_id via their single role. This is the ONLY function application code and RLS policies should use to make authorization decisions — never check role names directly.';

create or replace function public.get_user_tenants()
returns table (
  tenant_id uuid,
  tenant_name text,
  tenant_slug text,
  tenant_status text,
  role_key text,
  role_name text,
  membership_status text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    t.id,
    t.name,
    t.slug,
    t.status,
    r.key,
    r.name,
    tm.status
  from public.tenant_memberships tm
  join public.tenants t on t.id = tm.tenant_id
  join public.roles r on r.id = tm.role_id
  where tm.user_id = auth.uid()
    and tm.status = 'active'
    and t.deleted_at is null
  order by t.name;
$$;

comment on function public.get_user_tenants() is
  'Authoritative list of tenants the CALLING user currently has active access to. The active-tenant cookie is only ever validated against this function''s result — it never grants access on its own.';

-- =============================================================================
-- 3. Audit logging
-- =============================================================================

create or replace function public.log_audit_event(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb,
  p_ip_address text default null,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  -- An actor can only ever log an event on their own behalf. System/webhook
  -- events (no human actor) pass p_actor_user_id => null, which is exempt.
  if p_actor_user_id is not null and p_actor_user_id <> auth.uid() then
    raise exception 'Cannot log an audit event on behalf of another user' using errcode = '42501';
  end if;

  insert into public.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata, ip_address, user_agent
  )
  values (
    p_tenant_id, p_actor_user_id, p_action, p_entity_type, p_entity_id,
    coalesce(p_metadata, '{}'::jsonb), p_ip_address, p_user_agent
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.log_audit_event(uuid, uuid, text, text, uuid, jsonb, text, text) is
  'The only sanctioned way to write to audit_logs. Deliberately does NOT swallow exceptions: for actions logged from inside another SECURITY DEFINER function (e.g. create_tenant_with_owner), a failed audit insert rolls back the entire action, guaranteeing sensitive actions can never happen without evidence. Best-effort, non-transactional events (auth.signed_in/out) are wrapped in a try/catch at the application layer instead (see src/lib/audit/log.ts).';

-- =============================================================================
-- 4. Tenant creation (atomic: tenant + owner membership + audit trail)
-- =============================================================================

create or replace function public.create_tenant_with_owner(p_name text, p_slug text)
returns public.tenants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_owner_role_id uuid;
  v_tenant public.tenants;
  v_membership_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_name is null or length(btrim(p_name)) < 2 then
    raise exception 'Tenant name is too short' using errcode = '22023';
  end if;

  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Invalid tenant slug' using errcode = '22023';
  end if;

  select id into v_owner_role_id from public.roles where key = 'owner' and is_system = true;
  if v_owner_role_id is null then
    raise exception 'System role "owner" is not seeded' using errcode = 'XX000';
  end if;

  insert into public.tenants (name, slug, status, created_by)
  values (btrim(p_name), p_slug, 'active', v_user_id)
  returning * into v_tenant;

  insert into public.tenant_memberships (tenant_id, user_id, role_id, status, joined_at)
  values (v_tenant.id, v_user_id, v_owner_role_id, 'active', now())
  returning id into v_membership_id;

  perform public.log_audit_event(
    v_tenant.id, v_user_id, 'tenant.created', 'tenant', v_tenant.id,
    jsonb_build_object('name', v_tenant.name, 'slug', v_tenant.slug)
  );
  perform public.log_audit_event(
    v_tenant.id, v_user_id, 'membership.role_assigned', 'tenant_membership', v_membership_id,
    jsonb_build_object('role', 'owner')
  );

  return v_tenant;
exception
  when unique_violation then
    raise exception 'That business URL is already taken' using errcode = '23505';
end;
$$;

comment on function public.create_tenant_with_owner(text, text) is
  'Atomically creates a tenant, its owner membership for the calling user, and the audit trail for both. Runs inside the caller''s transaction: any failure (including a failed audit insert) rolls back everything, so a tenant can never exist without an owner. This is the ONLY way tenants are created — there is no client-facing INSERT policy on public.tenants.';

-- =============================================================================
-- 5. Last-owner protection (defense in depth: applies no matter the call path)
-- =============================================================================

create or replace function public.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_role_id uuid;
  v_remaining_owners int;
begin
  select id into v_owner_role_id from public.roles where key = 'owner' and is_system = true;

  if old.role_id = v_owner_role_id and old.status = 'active' then
    if (new.role_id is distinct from old.role_id) or (new.status is distinct from old.status) then
      select count(*) into v_remaining_owners
      from public.tenant_memberships
      where tenant_id = old.tenant_id
        and role_id = v_owner_role_id
        and status = 'active'
        and id <> old.id;

      if v_remaining_owners = 0 then
        raise exception 'A tenant must always have at least one active owner' using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.protect_last_owner() is
  'Blocks demoting/suspending/removing the last active owner of a tenant. Enforced as a trigger (not just in application code) so it holds even against direct table access.';

create trigger trg_protect_last_owner
  before update on public.tenant_memberships
  for each row execute function public.protect_last_owner();

-- =============================================================================
-- 6. Self-modification protection (defense in depth)
-- =============================================================================

create or replace function public.prevent_self_membership_modification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.user_id = auth.uid()
     and (new.role_id is distinct from old.role_id or new.status is distinct from old.status) then
    raise exception 'You cannot change your own role or membership status' using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.prevent_self_membership_modification() is
  'Blocks a user from elevating (or otherwise changing) their own role or status, even via update_membership(). Complements the identical check inside update_membership() as defense in depth.';

create trigger trg_prevent_self_membership_modification
  before update on public.tenant_memberships
  for each row execute function public.prevent_self_membership_modification();

-- =============================================================================
-- 7. Membership mutation API (role changes, suspend, remove)
-- =============================================================================

create or replace function public.update_membership(
  p_membership_id uuid,
  p_new_status text default null,
  p_new_role_key text default null
)
returns public.tenant_memberships
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.tenant_memberships;
  v_owner_role_id uuid;
  v_new_role_id uuid;
  v_result public.tenant_memberships;
begin
  select * into v_row from public.tenant_memberships where id = p_membership_id;
  if not found then
    raise exception 'Membership not found' using errcode = 'P0002';
  end if;

  if v_row.user_id = auth.uid() then
    raise exception 'You cannot modify your own membership' using errcode = '42501';
  end if;

  select id into v_owner_role_id from public.roles where key = 'owner' and is_system = true;

  -- Stricter-than-minimum interpretation of "admin has limited members.update":
  -- only an owner may change anything about another owner's membership.
  if v_row.role_id = v_owner_role_id
     and not public.user_has_permission(v_row.tenant_id, 'roles.manage') then
    raise exception 'Only an owner can modify another owner''s membership' using errcode = '42501';
  end if;

  if p_new_role_key is not null then
    if not public.user_has_permission(v_row.tenant_id, 'members.update') then
      raise exception 'Missing permission: members.update' using errcode = '42501';
    end if;
    select id into v_new_role_id from public.roles where key = p_new_role_key and is_system = true;
    if v_new_role_id is null then
      raise exception 'Unknown role: %', p_new_role_key using errcode = '22023';
    end if;
  end if;

  if p_new_status is not null then
    if p_new_status not in ('active', 'suspended', 'removed') then
      raise exception 'Unknown status: %', p_new_status using errcode = '22023';
    end if;
    if p_new_status = 'removed' then
      if not public.user_has_permission(v_row.tenant_id, 'members.remove') then
        raise exception 'Missing permission: members.remove' using errcode = '42501';
      end if;
    else
      if not public.user_has_permission(v_row.tenant_id, 'members.update') then
        raise exception 'Missing permission: members.update' using errcode = '42501';
      end if;
    end if;
  end if;

  update public.tenant_memberships
     set role_id = coalesce(v_new_role_id, role_id),
         status = coalesce(p_new_status, status)
   where id = p_membership_id
   returning * into v_result;

  if p_new_role_key is not null then
    perform public.log_audit_event(
      v_row.tenant_id, auth.uid(), 'membership.role_assigned', 'tenant_membership', p_membership_id,
      jsonb_build_object('role', p_new_role_key, 'target_user_id', v_row.user_id)
    );
  end if;

  if p_new_status is not null then
    perform public.log_audit_event(
      v_row.tenant_id, auth.uid(),
      case p_new_status
        when 'active' then 'membership.activated'
        when 'suspended' then 'membership.suspended'
        when 'removed' then 'membership.removed'
      end,
      'tenant_membership', p_membership_id,
      jsonb_build_object('status', p_new_status, 'target_user_id', v_row.user_id)
    );
  end if;

  return v_result;
end;
$$;

comment on function public.update_membership(uuid, text, text) is
  'Changes a membership''s role and/or status. Re-validates members.update / members.remove permission server-side regardless of what the app layer already checked. Cannot be used to modify your own membership or (unless you are an owner) another owner''s membership.';

-- =============================================================================
-- 8. Invitation (Phase 0 simplification: existing accounts only, auto-active)
-- =============================================================================

create or replace function public.invite_member_by_email(
  p_tenant_id uuid,
  p_email text,
  p_role_key text
)
returns public.tenant_memberships
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target_user_id uuid;
  v_role_id uuid;
  v_result public.tenant_memberships;
begin
  if not public.user_has_permission(p_tenant_id, 'members.invite') then
    raise exception 'Missing permission: members.invite' using errcode = '42501';
  end if;

  if p_role_key = 'owner' then
    raise exception 'Use tenant ownership transfer to grant the owner role (not implemented in Phase 0)' using errcode = '42501';
  end if;

  select id into v_target_user_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_target_user_id is null then
    raise exception 'No Scopevia account exists yet for that email. Ask them to sign up first, then invite them.' using errcode = 'P0002';
  end if;

  select id into v_role_id from public.roles where key = p_role_key and is_system = true;
  if v_role_id is null then
    raise exception 'Unknown role: %', p_role_key using errcode = '22023';
  end if;

  insert into public.tenant_memberships (tenant_id, user_id, role_id, status, invited_by, joined_at)
  values (p_tenant_id, v_target_user_id, v_role_id, 'active', auth.uid(), now())
  on conflict (tenant_id, user_id) do update
    set status = 'active', role_id = excluded.role_id, invited_by = excluded.invited_by, joined_at = now()
    where public.tenant_memberships.status = 'removed'
  returning * into v_result;

  if v_result.id is null then
    raise exception 'That person is already a member of this tenant' using errcode = '23505';
  end if;

  perform public.log_audit_event(
    p_tenant_id, auth.uid(), 'membership.created', 'tenant_membership', v_result.id,
    jsonb_build_object('invited_email', p_email, 'role', p_role_key)
  );

  return v_result;
end;
$$;

comment on function public.invite_member_by_email(uuid, text, text) is
  'Phase 0 simplification: adds an EXISTING Scopevia user directly as an active member (no email invitation token / pending-acceptance flow yet — that is deferred to a later CRM/organization phase, see docs/12-delivery-roadmap.md). Cannot be used to grant the owner role.';

-- =============================================================================
-- 9. Automatic audit trail for direct-SQL updates (tenant rename, profile edits)
-- =============================================================================

create or replace function public.audit_tenant_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.name is distinct from old.name or new.status is distinct from old.status then
    perform public.log_audit_event(
      new.id, auth.uid(), 'tenant.updated', 'tenant', new.id,
      jsonb_build_object('before', jsonb_build_object('name', old.name, 'status', old.status),
                          'after', jsonb_build_object('name', new.name, 'status', new.status))
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_tenant_update
  after update on public.tenants
  for each row execute function public.audit_tenant_update();

create or replace function public.audit_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.log_audit_event(
    null, auth.uid(), 'profile.updated', 'profile', new.id, '{}'::jsonb
  );
  return new;
end;
$$;

create trigger trg_audit_profile_update
  after update on public.profiles
  for each row execute function public.audit_profile_update();

-- =============================================================================
-- 10. Execute grants — deny by default, then allow exactly what's needed.
-- =============================================================================

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.protect_last_owner() from public, anon, authenticated;
revoke execute on function public.prevent_self_membership_modification() from public, anon, authenticated;
revoke execute on function public.audit_tenant_update() from public, anon, authenticated;
revoke execute on function public.audit_profile_update() from public, anon, authenticated;
revoke execute on function public.prevent_audit_log_mutation() from public, anon, authenticated;
-- (trigger functions are invoked by Postgres itself, never called directly)

revoke execute on function public.user_is_active_tenant_member(uuid) from public;
grant execute on function public.user_is_active_tenant_member(uuid) to authenticated;

revoke execute on function public.user_has_permission(uuid, text) from public;
grant execute on function public.user_has_permission(uuid, text) to authenticated;

revoke execute on function public.get_user_tenants() from public;
grant execute on function public.get_user_tenants() to authenticated;

revoke execute on function public.log_audit_event(uuid, uuid, text, text, uuid, jsonb, text, text) from public;
grant execute on function public.log_audit_event(uuid, uuid, text, text, uuid, jsonb, text, text) to authenticated;

revoke execute on function public.create_tenant_with_owner(text, text) from public;
grant execute on function public.create_tenant_with_owner(text, text) to authenticated;

revoke execute on function public.update_membership(uuid, text, text) from public;
grant execute on function public.update_membership(uuid, text, text) to authenticated;

revoke execute on function public.invite_member_by_email(uuid, text, text) from public;
grant execute on function public.invite_member_by_email(uuid, text, text) to authenticated;
