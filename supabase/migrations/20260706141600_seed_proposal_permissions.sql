-- Phase 2A: Proposal-centric pivot — permission & role_permissions seed.
-- Idempotent, same discipline as 20260702131100_seed_crm_permissions.sql.
--
-- Deliberate decision (docs/27 of the brief, "Decide expresamente si Sales
-- puede modificar precios"): Sales gets proposals.create/update/mark_ready
-- but NOT proposals.manage_pricing by default — they prepare scope/photos,
-- Owner/Admin/Estimator reviews and finalizes pricing. This can be revisited
-- as a real commercial decision later; it is not a technical limitation.
--
-- Field Worker gets proposals.view/portfolio.view/media.view/media.upload
-- (current-job photos) but nothing else — no pricing, no terms, no
-- mark_ready, no archive, matching the brief's matrix exactly.

insert into public.permissions (key, name, description) values
  ('proposals.view',              'View proposals',                 'View proposals and their pricing'),
  ('proposals.create',            'Create proposals',               'Create a new proposal, directly or from an opportunity'),
  ('proposals.update',            'Update proposals',               'Edit a proposal''s scope, schedule, and non-pricing content'),
  ('proposals.archive',           'Archive proposals',              'Archive a draft or ready proposal'),
  ('proposals.restore',           'Restore proposals',              'Restore an archived proposal'),
  ('proposals.mark_ready',        'Mark proposals ready',           'Move a proposal between draft and ready'),
  ('proposals.manage_pricing',    'Manage proposal pricing',        'Edit labor, line items, discounts, and tax on a proposal'),
  ('proposal_versions.create',    'Create proposal versions',       'Create a new proposal version (architecture prep for sending)'),
  ('proposal_versions.view',      'View proposal versions',         'View proposal version history'),
  ('portfolio.view',              'View portfolio',                 'View the portfolio of previous work'),
  ('portfolio.create',            'Create portfolio items',         'Add a new portfolio project'),
  ('portfolio.update',            'Update portfolio items',         'Edit a portfolio project and its photos'),
  ('portfolio.archive',           'Archive portfolio items',        'Archive a portfolio project'),
  ('portfolio.restore',           'Restore portfolio items',        'Restore an archived portfolio project'),
  ('media.view',                  'View media',                     'View uploaded photos'),
  ('media.upload',                'Upload media',                   'Upload a new photo'),
  ('media.update',                'Update media',                   'Edit a photo''s caption'),
  ('media.archive',               'Archive media',                  'Archive a photo'),
  ('proposal_settings.view',      'View proposal settings',         'View tenant-wide proposal defaults'),
  ('proposal_settings.update',    'Update proposal settings',       'Edit tenant-wide proposal defaults')
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description;

with role_perm_matrix (role_key, permission_key) as (
  values
    -- owner & admin: every Phase 2A permission
    ('owner', 'proposals.view'), ('owner', 'proposals.create'), ('owner', 'proposals.update'),
    ('owner', 'proposals.archive'), ('owner', 'proposals.restore'), ('owner', 'proposals.mark_ready'),
    ('owner', 'proposals.manage_pricing'), ('owner', 'proposal_versions.create'), ('owner', 'proposal_versions.view'),
    ('owner', 'portfolio.view'), ('owner', 'portfolio.create'), ('owner', 'portfolio.update'),
    ('owner', 'portfolio.archive'), ('owner', 'portfolio.restore'),
    ('owner', 'media.view'), ('owner', 'media.upload'), ('owner', 'media.update'), ('owner', 'media.archive'),
    ('owner', 'proposal_settings.view'), ('owner', 'proposal_settings.update'),

    ('admin', 'proposals.view'), ('admin', 'proposals.create'), ('admin', 'proposals.update'),
    ('admin', 'proposals.archive'), ('admin', 'proposals.restore'), ('admin', 'proposals.mark_ready'),
    ('admin', 'proposals.manage_pricing'), ('admin', 'proposal_versions.create'), ('admin', 'proposal_versions.view'),
    ('admin', 'portfolio.view'), ('admin', 'portfolio.create'), ('admin', 'portfolio.update'),
    ('admin', 'portfolio.archive'), ('admin', 'portfolio.restore'),
    ('admin', 'media.view'), ('admin', 'media.upload'), ('admin', 'media.update'), ('admin', 'media.archive'),
    ('admin', 'proposal_settings.view'), ('admin', 'proposal_settings.update'),

    -- estimator: full pricing authority, no settings/archive-restore
    ('estimator', 'proposals.view'), ('estimator', 'proposals.create'), ('estimator', 'proposals.update'),
    ('estimator', 'proposals.mark_ready'), ('estimator', 'proposals.manage_pricing'),
    ('estimator', 'proposal_versions.create'), ('estimator', 'proposal_versions.view'),
    ('estimator', 'portfolio.view'), ('estimator', 'media.view'), ('estimator', 'media.upload'),
    ('estimator', 'proposal_settings.view'),

    -- sales: prepares proposals, no pricing authority by default (see module comment)
    ('sales', 'proposals.view'), ('sales', 'proposals.create'), ('sales', 'proposals.update'),
    ('sales', 'proposals.mark_ready'), ('sales', 'proposal_versions.view'),
    ('sales', 'portfolio.view'), ('sales', 'media.view'), ('sales', 'media.upload'),

    -- field_worker: view + upload current-job photos only, per the brief's matrix
    ('field_worker', 'proposals.view'), ('field_worker', 'portfolio.view'),
    ('field_worker', 'media.view'), ('field_worker', 'media.upload'),

    -- viewer: read-only across the whole module
    ('viewer', 'proposals.view'), ('viewer', 'proposal_versions.view'),
    ('viewer', 'portfolio.view'), ('viewer', 'media.view'), ('viewer', 'proposal_settings.view')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from role_perm_matrix m
join public.roles r on r.key = m.role_key and r.is_system = true
join public.permissions p on p.key = m.permission_key
on conflict (role_id, permission_id) do nothing;
