-- Phase 3B.1: Proposal Revision / New Version Flow — permission seed.
-- Idempotent, same discipline as every prior phase's permission seed.
--
-- Deliberate decision (brief section 12, "Sales ya tiene
-- proposals.mark_ready, evaluar si aplica"): Sales gets
-- proposals.create_revision alongside Owner/Admin/Estimator. Sales already
-- prepares/re-sends proposals end to end (proposals.create/update/
-- mark_ready, proposal_portal_links.create) without pricing authority
-- (proposals.manage_pricing is Owner/Admin/Estimator only, per Phase 2A's
-- own documented decision) — starting a revision doesn't touch pricing by
-- itself, it only copies the prior snapshot into a new editable draft, so
-- the same boundary applies here unchanged: Sales can kick off and resend a
-- revised proposal, but still cannot edit its labor/materials/discount/tax
-- once it's copied over. Viewer/Field Worker get nothing, matching the
-- brief's matrix.
insert into public.permissions (key, name, description) values
  ('proposals.create_revision', 'Create proposal revisions', 'Create a new draft version from an accepted or declined proposal, without editing what the client already saw')
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description;

with role_perm_matrix (role_key, permission_key) as (
  values
    ('owner', 'proposals.create_revision'),
    ('admin', 'proposals.create_revision'),
    ('estimator', 'proposals.create_revision'),
    ('sales', 'proposals.create_revision')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from role_perm_matrix m
join public.roles r on r.key = m.role_key and r.is_system = true
join public.permissions p on p.key = m.permission_key
on conflict (role_id, permission_id) do nothing;
