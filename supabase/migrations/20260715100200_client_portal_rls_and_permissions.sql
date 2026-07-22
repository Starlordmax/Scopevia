-- Phase 3A: Client Portal — RLS policies and permission seed.
--
-- proposal_portal_links: SELECT for tenant members holding
-- proposal_portal_links.view — safe to expose (token_hash is a one-way
-- digest, the raw token is never stored anywhere). No INSERT/UPDATE policy:
-- mutated exclusively via create_proposal_portal_link()/
-- revoke_proposal_portal_link() (SECURITY DEFINER, called with the
-- contractor's own session).
--
-- proposal_portal_otps / proposal_portal_sessions: RLS enabled, ZERO
-- policies. A portal visitor has no Supabase Auth session, so there is no
-- `authenticated`/`anon` caller that should EVER see these rows directly —
-- every read/write goes through the four portal_*() SECURITY DEFINER
-- functions, called exclusively via the service-role admin client, which
-- bypasses RLS by design. This is the "no policy at all" pattern, not
-- "policy that always evaluates to false" — simpler, and impossible to
-- accidentally loosen later by editing a `using (...)` clause.
--
-- proposal_view_events: SELECT for tenant members holding proposals.view (no
-- new permission needed — this is just "can this person see this
-- proposal's activity"). No INSERT policy: written exclusively by
-- portal_get_session_context().

alter table public.proposal_portal_links enable row level security;

create policy proposal_portal_links_select on public.proposal_portal_links
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'proposal_portal_links.view'));

grant select on public.proposal_portal_links to authenticated;

alter table public.proposal_portal_otps enable row level security;
-- No policies, no grants — see header.

alter table public.proposal_portal_sessions enable row level security;
-- No policies, no grants — see header.

alter table public.proposal_view_events enable row level security;

create policy proposal_view_events_select on public.proposal_view_events
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'proposals.view'));

grant select on public.proposal_view_events to authenticated;

-- =============================================================================
-- Permissions
--
-- Owner/Admin/Estimator: create + view + revoke, matching the brief's
-- explicit "Owner/Admin/Estimator pueden crear link."
--
-- Sales: also gets create + view + revoke. Deliberate decision (brief section
-- 9 leaves this to us, "si decides permitirlo y lo documentas"): Sales
-- already holds proposals.mark_ready — the transition immediately before a
-- portal link becomes meaningful (a link can only target a 'ready'
-- proposal) — so extending the same trust level to portal link management
-- is consistent with that existing boundary. This is a commercial decision,
-- not a technical limitation, and can be revisited later exactly like the
-- Sales/manage_pricing boundary in 20260706141600_seed_proposal_permissions.sql.
--
-- Field Worker: none — consistent with Field Worker lacking proposals.update
-- and any other client-communication-facing capability.
--
-- Viewer: view only, matching the existing "read-only across the whole
-- module" pattern for every other Phase 2 permission group.
-- =============================================================================

insert into public.permissions (key, name, description) values
  ('proposal_portal_links.create', 'Create client portal links', 'Generate a secure client portal link for a ready proposal'),
  ('proposal_portal_links.view',   'View client portal links',   'View a proposal''s client portal links and their status'),
  ('proposal_portal_links.revoke', 'Revoke client portal links', 'Revoke an existing client portal link, blocking further access')
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description;

with role_perm_matrix (role_key, permission_key) as (
  values
    ('owner', 'proposal_portal_links.create'), ('owner', 'proposal_portal_links.view'), ('owner', 'proposal_portal_links.revoke'),
    ('admin', 'proposal_portal_links.create'), ('admin', 'proposal_portal_links.view'), ('admin', 'proposal_portal_links.revoke'),
    ('estimator', 'proposal_portal_links.create'), ('estimator', 'proposal_portal_links.view'), ('estimator', 'proposal_portal_links.revoke'),
    ('sales', 'proposal_portal_links.create'), ('sales', 'proposal_portal_links.view'), ('sales', 'proposal_portal_links.revoke'),
    ('viewer', 'proposal_portal_links.view')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from role_perm_matrix m
join public.roles r on r.key = m.role_key and r.is_system = true
join public.permissions p on p.key = m.permission_key
on conflict (role_id, permission_id) do nothing;
