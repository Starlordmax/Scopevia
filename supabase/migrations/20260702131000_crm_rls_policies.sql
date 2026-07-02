-- Phase 1: CRM & Projects — Row Level Security
--
-- Same deny-by-default discipline as Phase 0: RLS enabled on every table,
-- every policy scoped `to authenticated` explicitly (never `anon`), and no
-- insert/update/delete grant on any of these tables for `authenticated` —
-- every mutation goes exclusively through the SECURITY DEFINER functions in
-- the preceding migrations, which run as the table owner and bypass RLS for
-- their own writes. Direct client-side `.insert()`/`.update()`/`.delete()`
-- calls against these tables are impossible by design, not merely discouraged.

-- =============================================================================
-- clients
-- =============================================================================

alter table public.clients enable row level security;

create policy clients_select on public.clients
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'clients.view'));

grant select on public.clients to authenticated;

-- =============================================================================
-- client_contacts
-- =============================================================================

alter table public.client_contacts enable row level security;

create policy client_contacts_select on public.client_contacts
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'contacts.view'));

grant select on public.client_contacts to authenticated;

-- =============================================================================
-- opportunities
-- =============================================================================

alter table public.opportunities enable row level security;

create policy opportunities_select on public.opportunities
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'opportunities.view'));

grant select on public.opportunities to authenticated;

-- =============================================================================
-- projects
-- =============================================================================

alter table public.projects enable row level security;

create policy projects_select on public.projects
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'projects.view'));

grant select on public.projects to authenticated;

-- =============================================================================
-- project_addresses
-- =============================================================================

alter table public.project_addresses enable row level security;

create policy project_addresses_select on public.project_addresses
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'projects.view'));

grant select on public.project_addresses to authenticated;

-- =============================================================================
-- crm_notes
-- =============================================================================

alter table public.crm_notes enable row level security;

-- notes.view alone is NOT sufficient: a note is only visible if the caller
-- can ALSO see whichever parent it's attached to. Without this, a role like
-- field_worker (notes.view + projects.view, but no clients.view/
-- opportunities.view) could read a client- or opportunity-attached note by
-- querying crm_notes directly, bypassing the fact that they can't otherwise
-- see that client/opportunity at all.
create policy crm_notes_select on public.crm_notes
  for select to authenticated
  using (
    public.user_has_permission(tenant_id, 'notes.view')
    and (
      (client_id is not null and public.user_has_permission(tenant_id, 'clients.view'))
      or (opportunity_id is not null and public.user_has_permission(tenant_id, 'opportunities.view'))
      or (project_id is not null and public.user_has_permission(tenant_id, 'projects.view'))
    )
  );

grant select on public.crm_notes to authenticated;

-- =============================================================================
-- crm_activities
-- =============================================================================

alter table public.crm_activities enable row level security;

-- Same reasoning as crm_notes_select above: activities.view is necessary but
-- not sufficient — the caller must also be able to see the specific
-- client/opportunity/project the activity is about.
create policy crm_activities_select on public.crm_activities
  for select to authenticated
  using (
    public.user_has_permission(tenant_id, 'activities.view')
    and (
      (client_id is not null and public.user_has_permission(tenant_id, 'clients.view'))
      or (opportunity_id is not null and public.user_has_permission(tenant_id, 'opportunities.view'))
      or (project_id is not null and public.user_has_permission(tenant_id, 'projects.view'))
    )
  );

grant select on public.crm_activities to authenticated;
-- No insert/update/delete grant: writes go exclusively through
-- log_crm_activity(), and UPDATE/DELETE are additionally blocked by
-- trg_crm_activities_no_update/no_delete even for roles that could
-- otherwise bypass RLS (e.g. service_role running raw SQL).
