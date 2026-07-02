-- Phase 0: Foundations
-- Seed data for system roles and permissions. Idempotent: safe to re-run
-- (e.g. after `supabase db reset`) without creating duplicates. This lives in
-- a versioned migration (not supabase/seed.sql) because these rows are
-- required reference data in every environment — development, staging and
-- production — not sample/test data.

insert into public.permissions (key, name, description) values
  ('tenant.view',     'View business',           'View this tenant''s basic profile and settings'),
  ('tenant.update',   'Update business',         'Rename the tenant or change its status'),
  ('members.view',    'View members',            'List members and their roles'),
  ('members.invite',  'Invite members',          'Add an existing Scopevia user to this tenant'),
  ('members.update',  'Update members',          'Change a member''s role or reactivate/suspend them'),
  ('members.remove',  'Remove members',          'Remove a member from this tenant'),
  ('roles.view',      'View roles',              'View the roles available in this tenant'),
  ('roles.manage',    'Manage roles',            'Manage role assignments involving the owner role'),
  ('audit.view',      'View audit log',          'View this tenant''s audit trail')
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description;

insert into public.roles (key, name, description, is_system, tenant_id) values
  ('owner',        'Owner',        'Full control over the business, billing and membership.', true, null),
  ('admin',        'Admin',        'Manages members and settings, cannot touch owner-level access.', true, null),
  ('estimator',    'Estimator',    'Builds estimates and proposals. Introduced fully in a later phase.', true, null),
  ('sales',        'Sales',        'Manages leads and clients. Introduced fully in a later phase.', true, null),
  ('field_worker', 'Field Worker', 'Views assigned projects in the field. Introduced fully in a later phase.', true, null),
  ('viewer',       'Viewer',       'Read-only access.', true, null)
on conflict (key) where is_system = true do update
  set name = excluded.name,
      description = excluded.description;

-- Permission matrix (see docs/06-security-and-rls.md and docs/14-phase-0-foundations.md
-- for the full rationale, including where this Phase-0 matrix deliberately
-- corrects/simplifies the originally proposed one).
with role_perm_matrix (role_key, permission_key) as (
  values
    -- owner: everything
    ('owner', 'tenant.view'), ('owner', 'tenant.update'),
    ('owner', 'members.view'), ('owner', 'members.invite'), ('owner', 'members.update'), ('owner', 'members.remove'),
    ('owner', 'roles.view'), ('owner', 'roles.manage'),
    ('owner', 'audit.view'),
    -- admin: everything except roles.manage (owner-level membership changes)
    ('admin', 'tenant.view'), ('admin', 'tenant.update'),
    ('admin', 'members.view'), ('admin', 'members.invite'), ('admin', 'members.update'), ('admin', 'members.remove'),
    ('admin', 'roles.view'),
    ('admin', 'audit.view'),
    -- estimator / sales / field_worker / viewer: view-only in Phase 0.
    -- Their real permissions (CRM, estimates, proposals) are introduced when
    -- those modules are built; granting more here would be speculative.
    ('estimator', 'tenant.view'),
    ('sales', 'tenant.view'),
    ('field_worker', 'tenant.view'),
    ('viewer', 'tenant.view')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from role_perm_matrix m
join public.roles r on r.key = m.role_key and r.is_system = true
join public.permissions p on p.key = m.permission_key
on conflict (role_id, permission_id) do nothing;
