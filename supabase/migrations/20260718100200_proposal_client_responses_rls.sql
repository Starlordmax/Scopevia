-- Phase 3B: Client Portal Accept/Decline — RLS.
--
-- proposal_client_responses: SELECT for tenant members holding
-- proposals.view (no new permission key needed — "can this person see this
-- proposal's response" is core proposal visibility, the exact same
-- reasoning already applied to proposal_view_events in Phase 3A). No
-- INSERT/UPDATE/DELETE policy at all: writes go exclusively through
-- submit_proposal_client_response() (SECURITY DEFINER, service-role only),
-- and UPDATE/DELETE are additionally blocked outright by the append-only
-- triggers from the schema migration, even for a role that could otherwise
-- bypass RLS.

alter table public.proposal_client_responses enable row level security;

create policy proposal_client_responses_select on public.proposal_client_responses
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'proposals.view'));

grant select on public.proposal_client_responses to authenticated;
