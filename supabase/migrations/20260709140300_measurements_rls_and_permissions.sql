-- Phase 2C: Measurements / Takeoff builder — permissions + RLS.
-- Same discipline as every other phase: RLS enabled, SELECT-only
-- policies keyed on user_has_permission(), `to authenticated` only,
-- every mutation goes through the SECURITY DEFINER functions in
-- 20260709140200_measurement_functions.sql / 20260709140100_labor_area_linear_pricing.sql.
--
-- measurements.generate_materials is deliberately withheld from
-- Sales/Field Worker (both lack proposals.manage_pricing, and the
-- brief conditions "generate materials/labor from a measurement" on
-- holding pricing permission) -- see the seed matrix below and
-- docs/48-measurement-rls-verification.md.

insert into public.permissions (key, name, description) values
  ('measurements.view',              'View measurements',                'View proposal measurements/takeoff data'),
  ('measurements.create',            'Create measurements',              'Add a measurement, manual or drawn'),
  ('measurements.update',            'Update measurements',              'Edit an existing measurement'),
  ('measurements.archive',           'Archive measurements',             'Archive a measurement'),
  ('measurements.generate_materials','Generate materials/labor',         'Generate a catalog material or labor item from a measurement''s calculated value')
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description;

with role_perm_matrix (role_key, permission_key) as (
  values
    -- owner & admin: full measurement authority
    ('owner', 'measurements.view'), ('owner', 'measurements.create'), ('owner', 'measurements.update'),
    ('owner', 'measurements.archive'), ('owner', 'measurements.generate_materials'),

    ('admin', 'measurements.view'), ('admin', 'measurements.create'), ('admin', 'measurements.update'),
    ('admin', 'measurements.archive'), ('admin', 'measurements.generate_materials'),

    -- estimator: full measurement authority
    ('estimator', 'measurements.view'), ('estimator', 'measurements.create'), ('estimator', 'measurements.update'),
    ('estimator', 'measurements.archive'), ('estimator', 'measurements.generate_materials'),

    -- sales: view/create/update, no archive, no generate (lacks proposals.manage_pricing)
    ('sales', 'measurements.view'), ('sales', 'measurements.create'), ('sales', 'measurements.update'),

    -- field_worker: view + create measurements only, per the brief's matrix
    ('field_worker', 'measurements.view'), ('field_worker', 'measurements.create'),

    -- viewer: read-only
    ('viewer', 'measurements.view')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from role_perm_matrix m
join public.roles r on r.key = m.role_key and r.is_system = true
join public.permissions p on p.key = m.permission_key
on conflict (role_id, permission_id) do nothing;

-- =============================================================================
-- RLS
-- =============================================================================

alter table public.proposal_measurement_groups enable row level security;
create policy proposal_measurement_groups_select on public.proposal_measurement_groups
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'measurements.view'));
grant select on public.proposal_measurement_groups to authenticated;

alter table public.proposal_measurements enable row level security;
create policy proposal_measurements_select on public.proposal_measurements
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'measurements.view'));
grant select on public.proposal_measurements to authenticated;

alter table public.proposal_measurement_shapes enable row level security;
create policy proposal_measurement_shapes_select on public.proposal_measurement_shapes
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'measurements.view'));
grant select on public.proposal_measurement_shapes to authenticated;

alter table public.proposal_measurement_materials enable row level security;
create policy proposal_measurement_materials_select on public.proposal_measurement_materials
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'measurements.view'));
grant select on public.proposal_measurement_materials to authenticated;
