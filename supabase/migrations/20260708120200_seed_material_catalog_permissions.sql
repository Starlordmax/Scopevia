-- Phase 2B: Material catalog & ZIP pricing — permission & role_permissions
-- seed. Idempotent, same discipline as 20260706141600_seed_proposal_permissions.sql.
--
-- Deliberate decisions (docs/42-material-catalog-by-zip.md, "Permissions"):
-- - Adding a catalog item to a proposal at its catalog price only requires
--   proposals.update (which Sales already has) -- it is not a pricing
--   decision, it's picking from an already-priced list. OVERRIDING that
--   catalog price with a manual value still requires
--   proposals.manage_pricing (which Sales deliberately lacks, per
--   20260706141600's module comment) -- this file does not touch that
--   permission, it is enforced in add_proposal_line_item_from_catalog()
--   in 20260708120300_material_catalog_functions.sql.
-- - materials.*/material_prices.* govern the CATALOG itself (creating a
--   tenant's own custom material, editing a tenant price override) -- the
--   global catalog is seed/migration-only in this phase, no role gets a
--   permission to edit it because no exposed function allows editing it.

insert into public.permissions (key, name, description) values
  ('materials.view',          'View materials',           'View the material catalog (global + own tenant)'),
  ('materials.create',        'Create materials',         'Add a custom material to the tenant''s own catalog'),
  ('materials.update',        'Update materials',         'Edit a tenant''s own custom material'),
  ('materials.archive',       'Archive materials',        'Archive a tenant''s own custom material'),
  ('material_prices.view',    'View material prices',     'View ZIP-based material prices (global + own tenant)'),
  ('material_prices.create',  'Create material prices',   'Add a tenant-owned price override'),
  ('material_prices.update',  'Update material prices',   'Edit a tenant-owned price override'),
  ('material_prices.archive', 'Archive material prices',  'Archive a tenant-owned price override')
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description;

with role_perm_matrix (role_key, permission_key) as (
  values
    -- owner & admin: full catalog + price authority over their own tenant's rows
    ('owner', 'materials.view'), ('owner', 'materials.create'), ('owner', 'materials.update'), ('owner', 'materials.archive'),
    ('owner', 'material_prices.view'), ('owner', 'material_prices.create'), ('owner', 'material_prices.update'), ('owner', 'material_prices.archive'),

    ('admin', 'materials.view'), ('admin', 'materials.create'), ('admin', 'materials.update'), ('admin', 'materials.archive'),
    ('admin', 'material_prices.view'), ('admin', 'material_prices.create'), ('admin', 'material_prices.update'), ('admin', 'material_prices.archive'),

    -- estimator: can maintain the tenant's own materials/prices
    ('estimator', 'materials.view'), ('estimator', 'materials.create'), ('estimator', 'materials.update'),
    ('estimator', 'material_prices.view'), ('estimator', 'material_prices.create'), ('estimator', 'material_prices.update'),

    -- sales: can browse the catalog and add items to a proposal
    -- (proposals.update, already held -- see module comment), but cannot
    -- create/edit materials or prices themselves
    ('sales', 'materials.view'), ('sales', 'material_prices.view'),

    -- field_worker: view only, matching their read-only stance elsewhere
    ('field_worker', 'materials.view'), ('field_worker', 'material_prices.view'),

    -- viewer: read-only across the whole module
    ('viewer', 'materials.view'), ('viewer', 'material_prices.view')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from role_perm_matrix m
join public.roles r on r.key = m.role_key and r.is_system = true
join public.permissions p on p.key = m.permission_key
on conflict (role_id, permission_id) do nothing;
