-- Phase 2A: Proposal-centric pivot — Row Level Security.
--
-- Same discipline as Phase 0/1: RLS enabled on every table, SELECT-only
-- policies keyed on user_has_permission(), `to authenticated` only (never
-- `anon`), no insert/update/delete grant anywhere — every mutation goes
-- through the SECURITY DEFINER functions in the preceding migrations.
--
-- RLS grants tenant-wide read access to whichever tenants the caller is an
-- active member of; it does NOT know which tenant is "currently active" in
-- the UI (that's a cookie, resolved server-side — see
-- src/lib/auth/tenant.ts). Every Phase 2A page query additionally filters
-- `.eq('tenant_id', activeTenant.id)` explicitly, exactly like Phase 1, so a
-- multi-tenant user's stale URL from a previously-active tenant can never
-- leak into the currently-active one — see docs/35-phase-2a-rls-verification.md.

alter table public.tenant_proposal_settings enable row level security;
create policy tenant_proposal_settings_select on public.tenant_proposal_settings
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'proposal_settings.view'));
grant select on public.tenant_proposal_settings to authenticated;

alter table public.proposals enable row level security;
create policy proposals_select on public.proposals
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'proposals.view'));
grant select on public.proposals to authenticated;

alter table public.proposal_versions enable row level security;
create policy proposal_versions_select on public.proposal_versions
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'proposals.view'));
grant select on public.proposal_versions to authenticated;

alter table public.proposal_sections enable row level security;
create policy proposal_sections_select on public.proposal_sections
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'proposals.view'));
grant select on public.proposal_sections to authenticated;

alter table public.proposal_labor_items enable row level security;
create policy proposal_labor_items_select on public.proposal_labor_items
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'proposals.view'));
grant select on public.proposal_labor_items to authenticated;

alter table public.proposal_line_items enable row level security;
create policy proposal_line_items_select on public.proposal_line_items
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'proposals.view'));
grant select on public.proposal_line_items to authenticated;

alter table public.media_assets enable row level security;
create policy media_assets_select on public.media_assets
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'media.view'));
grant select on public.media_assets to authenticated;

alter table public.portfolio_projects enable row level security;
create policy portfolio_projects_select on public.portfolio_projects
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'portfolio.view'));
grant select on public.portfolio_projects to authenticated;

alter table public.portfolio_project_media enable row level security;
create policy portfolio_project_media_select on public.portfolio_project_media
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'portfolio.view'));
grant select on public.portfolio_project_media to authenticated;

alter table public.proposal_media enable row level security;
create policy proposal_media_select on public.proposal_media
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'proposals.view'));
grant select on public.proposal_media to authenticated;

-- proposal_creation_requests is an internal idempotency ledger, never read
-- directly by the client — no policy at all means deny-by-default with RLS
-- enabled (no grant either, so even attempting to query it fails on
-- permission before RLS is even evaluated).
alter table public.proposal_creation_requests enable row level security;
