-- AI-assisted proposal text — permission & role_permissions seed.
-- Idempotent, same discipline as every prior phase's seed migration.
--
-- `ai.generate_proposal_text` is a NEW permission (unlike business_profiles,
-- which reuses tenant.view/tenant.update) because it's a distinct,
-- action/cost-bearing capability -- calling a paid third-party API --
-- not just visibility into more tenant settings.
--
-- Role matrix, as specified: owner/admin/estimator/sales can generate,
-- viewer/field_worker cannot. Deliberate nuance (documented in
-- docs/77-ai-proposal-text-generation.md, "Permissions"): Sales gets this
-- permission for parity with their proposals.create/update access, but
-- the Terms & Pricing step's textareas that a generated draft gets
-- applied into are still gated on proposals.manage_pricing, which Sales
-- does NOT have by default (see 20260706141600_seed_proposal_permissions.sql's
-- own module comment) -- Sales can request/preview a draft, but applying
-- it to the saved proposal still requires manage_pricing, exactly like
-- every other edit on that step. Not a bug: the AI assistant follows the
-- same editing gate as the form it fills in.

insert into public.permissions (key, name, description) values
  ('ai.generate_proposal_text', 'Generate proposal text with AI', 'Use the AI writing assistant to draft Terms, Exclusions, and Notes for client')
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description;

with role_perm_matrix (role_key, permission_key) as (
  values
    ('owner', 'ai.generate_proposal_text'),
    ('admin', 'ai.generate_proposal_text'),
    ('estimator', 'ai.generate_proposal_text'),
    ('sales', 'ai.generate_proposal_text')
    -- viewer, field_worker: deliberately omitted -- read-only / field
    -- roles have no reason to trigger a paid AI call.
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from role_perm_matrix m
join public.roles r on r.key = m.role_key and r.is_system = true
join public.permissions p on p.key = m.permission_key
on conflict (role_id, permission_id) do nothing;
