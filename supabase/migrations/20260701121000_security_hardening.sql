-- Phase 0.5: Security hardening
--
-- Fixes identified during the Phase 0 security review (see
-- docs/18-phase-0-security-hardening.md for the full audit):
--
-- 1. protect_last_owner() had a race condition under concurrent transactions:
--    two simultaneous demotions of two different owners could both read
--    "1 other active owner remains" before either commits, leaving zero
--    owners. Fixed by locking the tenant row first, serializing all
--    membership mutations for that tenant.
-- 2. No DB-level guard preventing a membership from being assigned a role
--    that belongs to a different tenant (relevant once custom per-tenant
--    roles exist — schema-supported but not yet buildable in Phase 0).
-- 3. invite_member_by_email() granted immediate `active` access without the
--    invited user's consent. Changed to create `invited` memberships that
--    grant zero access (every RLS policy and helper function already
--    requires status='active') until the invited user explicitly accepts.

-- =============================================================================
-- 1. Concurrency-safe last-owner protection
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
  -- Lock the tenant row for the remainder of this transaction. Any other
  -- transaction trying to change a membership for the same tenant (via this
  -- same trigger) will block here until we commit or roll back, so the
  -- COUNT below always reflects a consistent, serialized view — closing the
  -- race where two concurrent demotions could each see "another owner
  -- remains" and both commit, leaving zero owners.
  perform 1 from public.tenants where id = old.tenant_id for update;

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
  'Blocks demoting/suspending/removing the last active owner of a tenant. Locks the tenant row first (FOR UPDATE) to serialize concurrent membership mutations and close a race where two simultaneous demotions could both succeed. Enforced as a trigger so it holds even against direct table access.';

-- =============================================================================
-- 2. Cross-tenant role assignment guard
-- =============================================================================

create or replace function public.validate_membership_role_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role_is_system boolean;
  v_role_tenant_id uuid;
begin
  select is_system, tenant_id into v_role_is_system, v_role_tenant_id
  from public.roles
  where id = new.role_id;

  if v_role_is_system is null then
    raise exception 'Unknown role_id' using errcode = '23503';
  end if;

  -- A system role (tenant_id IS NULL) may be used by any tenant. A custom
  -- role (future feature) may only be used by memberships of its own
  -- tenant — this is the DB-level guarantee that a role created for Tenant A
  -- can never be assigned to a membership of Tenant B, independent of
  -- whatever application code exists (or is added later) to create custom
  -- roles.
  if not v_role_is_system and v_role_tenant_id is distinct from new.tenant_id then
    raise exception 'Role % does not belong to tenant %', new.role_id, new.tenant_id using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_membership_role_tenant() is
  'Guarantees a tenant_membership can only use a global system role or a custom role belonging to its own tenant. Defense in depth for the (not yet built) custom-roles feature — the schema already supports tenant-scoped roles, so this guard exists ahead of that feature rather than being added later under time pressure.';

create trigger trg_validate_membership_role_tenant
  before insert or update on public.tenant_memberships
  for each row execute function public.validate_membership_role_tenant();

-- =============================================================================
-- 3. Self-modification guard: carve out "accept my own pending invitation"
-- =============================================================================

create or replace function public.prevent_self_membership_modification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_self_accept boolean;
begin
  v_is_self_accept := old.status = 'invited' and new.status = 'active' and new.role_id = old.role_id;

  if old.user_id = auth.uid()
     and (new.role_id is distinct from old.role_id or new.status is distinct from old.status)
     and not v_is_self_accept then
    raise exception 'You cannot change your own role or membership status' using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.prevent_self_membership_modification() is
  'Blocks a user from elevating (or otherwise changing) their own role or status, EXCEPT the single narrow transition of accepting their own pending invitation (invited -> active, role unchanged) via accept_invitation(). Every other self-modification remains blocked, including self-reactivation from suspended and self-role-changes.';

-- =============================================================================
-- 4. Invitations now grant zero access until explicitly accepted
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
    -- Deliberately identical error message/shape to the "already a member"
    -- and generic failure paths below is NOT attempted here: this endpoint
    -- is only reachable by an authenticated member with members.invite in
    -- this tenant (not a public/unauthenticated surface), so email
    -- enumeration risk is limited to already-trusted teammates, not the
    -- general public. See docs/18-phase-0-security-hardening.md, section
    -- "Invitations", for the accepted-risk rationale.
    raise exception 'No Scopevia account exists yet for that email. Ask them to sign up first, then invite them.' using errcode = 'P0002';
  end if;

  select id into v_role_id from public.roles where key = p_role_key and is_system = true;
  if v_role_id is null then
    raise exception 'Unknown role: %', p_role_key using errcode = '22023';
  end if;

  -- Grants ZERO access: status='invited' is excluded by every RLS policy and
  -- by user_is_active_tenant_member()/user_has_permission() (both require
  -- status='active'). The invited user must call accept_invitation()
  -- themselves before they can see or touch anything in this tenant.
  insert into public.tenant_memberships (tenant_id, user_id, role_id, status, invited_by, joined_at)
  values (p_tenant_id, v_target_user_id, v_role_id, 'invited', auth.uid(), null)
  on conflict (tenant_id, user_id) do update
    set status = 'invited', role_id = excluded.role_id, invited_by = excluded.invited_by, joined_at = null
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
  'Creates a PENDING (status=invited) membership for an existing Scopevia user — grants no access until the user calls accept_invitation(). No email-token flow yet (deferred); the invited user discovers the pending invitation by signing in and checking get_pending_invitations(). Cannot be used to grant the owner role.';

-- =============================================================================
-- 4.5. Close the consent-bypass gap: an admin must not be able to force an
--      invited membership to active on the invited user's behalf.
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

  if v_row.status = 'invited' and p_new_status = 'active' then
    raise exception 'A pending invitation can only be accepted by the invited user, via accept_invitation()' using errcode = '42501';
  end if;

  select id into v_owner_role_id from public.roles where key = 'owner' and is_system = true;

  -- Stricter-than-minimum interpretation of "admin has limited members.update":
  -- only an owner may change anything about another owner's membership.
  if v_row.role_id = v_owner_role_id
     and not public.user_has_permission(v_row.tenant_id, 'roles.manage') then
    raise exception 'Only an owner can modify another owner''s membership' using errcode = '42501';
  end if;

  if p_new_role_key is not null then
    -- Granting the owner role itself is a stricter operation than an
    -- ordinary role change: it requires roles.manage (Owner only), not just
    -- members.update (Owner + Admin). Without this, an Admin could promote
    -- any member straight to Owner — a real privilege-escalation path found
    -- during the Phase 0 security hardening review, closed here rather than
    -- left for "ownership transfer" to fix later.
    if p_new_role_key = 'owner' then
      if not public.user_has_permission(v_row.tenant_id, 'roles.manage') then
        raise exception 'Only an owner can grant the owner role' using errcode = '42501';
      end if;
    else
      if not public.user_has_permission(v_row.tenant_id, 'members.update') then
        raise exception 'Missing permission: members.update' using errcode = '42501';
      end if;
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
  'Changes a membership''s role and/or status. Re-validates members.update / members.remove permission server-side regardless of what the app layer already checked. Cannot be used to modify your own membership, to modify another owner''s membership unless you are an owner, or to activate someone else''s pending invitation on their behalf (must go through accept_invitation()).';

-- =============================================================================
-- 5. Accepting a pending invitation
-- =============================================================================

create or replace function public.accept_invitation(p_membership_id uuid)
returns public.tenant_memberships
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.tenant_memberships;
  v_result public.tenant_memberships;
begin
  select * into v_row from public.tenant_memberships where id = p_membership_id;
  if not found then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;

  if v_row.user_id <> auth.uid() then
    -- Same error as "not found" to avoid confirming that a membership row
    -- exists for someone else's account.
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;

  if v_row.status <> 'invited' then
    raise exception 'This invitation is no longer pending' using errcode = '22023';
  end if;

  update public.tenant_memberships
     set status = 'active', joined_at = now()
   where id = p_membership_id
   returning * into v_result;

  perform public.log_audit_event(
    v_row.tenant_id, auth.uid(), 'membership.activated', 'tenant_membership', p_membership_id,
    jsonb_build_object('accepted_by_user', true)
  );

  return v_result;
end;
$$;

comment on function public.accept_invitation(uuid) is
  'Lets the CALLING user accept their own pending invitation (status invited -> active). Cannot be used on anyone else''s membership (checked explicitly, and also enforced by RLS + the self-modification trigger''s narrow carve-out).';

create or replace function public.get_pending_invitations()
returns table (
  membership_id uuid,
  tenant_id uuid,
  tenant_name text,
  role_name text,
  invited_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select tm.id, t.id, t.name, r.name, tm.created_at
  from public.tenant_memberships tm
  join public.tenants t on t.id = tm.tenant_id
  join public.roles r on r.id = tm.role_id
  where tm.user_id = auth.uid()
    and tm.status = 'invited'
    and t.deleted_at is null
  order by tm.created_at desc;
$$;

comment on function public.get_pending_invitations() is
  'Pending (status=invited) memberships for the CALLING user — powers the "you have been invited" UI on /select-tenant.';

-- =============================================================================
-- 6. Grants
-- =============================================================================

revoke execute on function public.validate_membership_role_tenant() from public, anon, authenticated;

revoke execute on function public.accept_invitation(uuid) from public;
grant execute on function public.accept_invitation(uuid) to authenticated;

revoke execute on function public.get_pending_invitations() from public;
grant execute on function public.get_pending_invitations() to authenticated;
