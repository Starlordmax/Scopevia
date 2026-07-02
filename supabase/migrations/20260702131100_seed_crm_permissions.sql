-- Phase 1: CRM & Projects — permission & role_permissions seed
--
-- Idempotent (ON CONFLICT DO UPDATE/NOTHING), same discipline as
-- 20260701120900_seed_roles_and_permissions.sql. Verified empirically by
-- re-running against an already-seeded database (see
-- docs/23-phase-1-rls-verification.md).
--
-- See docs/20-phase-1-crm-and-projects.md for the full rationale behind each
-- role's grant list, including the deliberate asymmetries: estimator has no
-- opportunities.create (works leads handed to them by Sales, doesn't
-- originate them); sales has no projects.update (hands off to
-- estimator/ops after conversion); field_worker gets a BROAD projects.view
-- across the whole tenant, not scoped to "their" assigned projects — Phase 1
-- has no per-assignment RLS, and this is documented as a real limitation
-- rather than faked.

insert into public.permissions (key, name, description) values
  ('clients.view',     'View clients',              'View client records'),
  ('clients.create',   'Create clients',             'Create new client records'),
  ('clients.update',   'Update clients',             'Edit client records'),
  ('clients.archive',  'Archive clients',            'Archive a client'),
  ('clients.restore',  'Restore clients',            'Restore an archived client'),
  ('contacts.view',    'View contacts',              'View client contacts'),
  ('contacts.create',  'Create contacts',            'Add a contact to a client'),
  ('contacts.update',  'Update contacts',            'Edit a client contact, including which one is primary'),
  ('contacts.archive', 'Archive contacts',           'Archive a client contact'),
  ('contacts.restore', 'Restore contacts',           'Restore an archived client contact'),
  ('opportunities.view',               'View opportunities',              'View opportunities'),
  ('opportunities.create',             'Create opportunities',            'Create a new opportunity'),
  ('opportunities.update',             'Update opportunities',            'Edit an opportunity''s details'),
  ('opportunities.change_status',      'Change opportunity status',       'Move an opportunity through the pipeline'),
  ('opportunities.archive',            'Archive opportunities',           'Archive a won or lost opportunity'),
  ('opportunities.restore',            'Restore opportunities',           'Restore an archived opportunity'),
  ('opportunities.convert_to_project', 'Convert to project',              'Convert a qualified opportunity into a project'),
  ('projects.view',    'View projects',              'View projects'),
  ('projects.create',  'Create projects',            'Create a new project'),
  ('projects.update',  'Update projects',            'Edit a project, its status, and its addresses'),
  ('projects.archive', 'Archive projects',           'Archive a project'),
  ('projects.restore', 'Restore projects',           'Restore an archived project'),
  ('notes.view',       'View notes',                 'View CRM notes'),
  ('notes.create',     'Create notes',               'Add a CRM note'),
  ('notes.update',     'Update notes',                'Edit a CRM note'),
  ('notes.archive',    'Archive notes',               'Archive a CRM note'),
  ('activities.view',  'View activity',              'View the CRM activity timeline')
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description;

with role_perm_matrix (role_key, permission_key) as (
  values
    -- owner & admin: every Phase 1 permission
    ('owner', 'clients.view'), ('owner', 'clients.create'), ('owner', 'clients.update'), ('owner', 'clients.archive'), ('owner', 'clients.restore'),
    ('owner', 'contacts.view'), ('owner', 'contacts.create'), ('owner', 'contacts.update'), ('owner', 'contacts.archive'), ('owner', 'contacts.restore'),
    ('owner', 'opportunities.view'), ('owner', 'opportunities.create'), ('owner', 'opportunities.update'), ('owner', 'opportunities.change_status'),
    ('owner', 'opportunities.archive'), ('owner', 'opportunities.restore'), ('owner', 'opportunities.convert_to_project'),
    ('owner', 'projects.view'), ('owner', 'projects.create'), ('owner', 'projects.update'), ('owner', 'projects.archive'), ('owner', 'projects.restore'),
    ('owner', 'notes.view'), ('owner', 'notes.create'), ('owner', 'notes.update'), ('owner', 'notes.archive'),
    ('owner', 'activities.view'),

    ('admin', 'clients.view'), ('admin', 'clients.create'), ('admin', 'clients.update'), ('admin', 'clients.archive'), ('admin', 'clients.restore'),
    ('admin', 'contacts.view'), ('admin', 'contacts.create'), ('admin', 'contacts.update'), ('admin', 'contacts.archive'), ('admin', 'contacts.restore'),
    ('admin', 'opportunities.view'), ('admin', 'opportunities.create'), ('admin', 'opportunities.update'), ('admin', 'opportunities.change_status'),
    ('admin', 'opportunities.archive'), ('admin', 'opportunities.restore'), ('admin', 'opportunities.convert_to_project'),
    ('admin', 'projects.view'), ('admin', 'projects.create'), ('admin', 'projects.update'), ('admin', 'projects.archive'), ('admin', 'projects.restore'),
    ('admin', 'notes.view'), ('admin', 'notes.create'), ('admin', 'notes.update'), ('admin', 'notes.archive'),
    ('admin', 'activities.view'),

    -- estimator: works existing leads/projects; does not originate leads or archive/restore
    ('estimator', 'clients.view'), ('estimator', 'clients.create'), ('estimator', 'clients.update'),
    ('estimator', 'contacts.view'), ('estimator', 'contacts.create'), ('estimator', 'contacts.update'),
    ('estimator', 'opportunities.view'), ('estimator', 'opportunities.update'), ('estimator', 'opportunities.change_status'),
    ('estimator', 'opportunities.convert_to_project'),
    ('estimator', 'projects.view'), ('estimator', 'projects.create'), ('estimator', 'projects.update'),
    ('estimator', 'notes.view'), ('estimator', 'notes.create'), ('estimator', 'notes.update'),
    ('estimator', 'activities.view'),

    -- sales: originates leads/opportunities; hands projects off after creating them (no projects.update)
    ('sales', 'clients.view'), ('sales', 'clients.create'), ('sales', 'clients.update'),
    ('sales', 'contacts.view'), ('sales', 'contacts.create'), ('sales', 'contacts.update'),
    ('sales', 'opportunities.view'), ('sales', 'opportunities.create'), ('sales', 'opportunities.update'), ('sales', 'opportunities.change_status'),
    ('sales', 'opportunities.convert_to_project'),
    ('sales', 'projects.view'), ('sales', 'projects.create'),
    ('sales', 'notes.view'), ('sales', 'notes.create'), ('sales', 'notes.update'),
    ('sales', 'activities.view'),

    -- field_worker: broad read-only project visibility across the tenant (no
    -- per-assignment scoping in Phase 1 — see module comment above) + notes
    ('field_worker', 'projects.view'), ('field_worker', 'notes.view'), ('field_worker', 'notes.create'), ('field_worker', 'activities.view'),

    -- viewer: read-only across the whole module
    ('viewer', 'clients.view'), ('viewer', 'contacts.view'), ('viewer', 'opportunities.view'), ('viewer', 'projects.view'),
    ('viewer', 'notes.view'), ('viewer', 'activities.view')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from role_perm_matrix m
join public.roles r on r.key = m.role_key and r.is_system = true
join public.permissions p on p.key = m.permission_key
on conflict (role_id, permission_id) do nothing;
