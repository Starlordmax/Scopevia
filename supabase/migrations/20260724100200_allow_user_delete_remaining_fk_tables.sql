-- Continuation of 20260724100100: the same NO ACTION-by-default problem on
-- auth.users FKs exists on every remaining created_by/archived_by/
-- revoked_by column across the schema, discovered by exhaustively
-- retrying a bulk test-user deletion until no new 23503 errors appeared.
-- Same fix, same reasoning, applied uniformly: on delete set null, and
-- drop not null wherever the column was previously required.

alter table public.clients
  drop constraint clients_archived_by_fkey,
  add constraint clients_archived_by_fkey foreign key (archived_by) references auth.users (id) on delete set null;

alter table public.client_contacts
  drop constraint client_contacts_created_by_fkey,
  alter column created_by drop not null,
  add constraint client_contacts_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null,
  drop constraint client_contacts_archived_by_fkey,
  add constraint client_contacts_archived_by_fkey foreign key (archived_by) references auth.users (id) on delete set null;

alter table public.opportunities
  drop constraint opportunities_archived_by_fkey,
  add constraint opportunities_archived_by_fkey foreign key (archived_by) references auth.users (id) on delete set null;

alter table public.projects
  drop constraint projects_created_by_fkey,
  alter column created_by drop not null,
  add constraint projects_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null,
  drop constraint projects_archived_by_fkey,
  add constraint projects_archived_by_fkey foreign key (archived_by) references auth.users (id) on delete set null;

alter table public.project_addresses
  drop constraint project_addresses_created_by_fkey,
  alter column created_by drop not null,
  add constraint project_addresses_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null,
  drop constraint project_addresses_archived_by_fkey,
  add constraint project_addresses_archived_by_fkey foreign key (archived_by) references auth.users (id) on delete set null;

alter table public.crm_notes
  drop constraint crm_notes_archived_by_fkey,
  add constraint crm_notes_archived_by_fkey foreign key (archived_by) references auth.users (id) on delete set null;

alter table public.proposals
  drop constraint proposals_created_by_fkey,
  alter column created_by drop not null,
  add constraint proposals_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null,
  drop constraint proposals_archived_by_fkey,
  add constraint proposals_archived_by_fkey foreign key (archived_by) references auth.users (id) on delete set null;

alter table public.proposal_versions
  drop constraint proposal_versions_created_by_fkey,
  alter column created_by drop not null,
  add constraint proposal_versions_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

alter table public.media_assets
  drop constraint media_assets_archived_by_fkey,
  add constraint media_assets_archived_by_fkey foreign key (archived_by) references auth.users (id) on delete set null;

alter table public.portfolio_projects
  drop constraint portfolio_projects_created_by_fkey,
  alter column created_by drop not null,
  add constraint portfolio_projects_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null,
  drop constraint portfolio_projects_archived_by_fkey,
  add constraint portfolio_projects_archived_by_fkey foreign key (archived_by) references auth.users (id) on delete set null;

alter table public.proposal_measurement_groups
  drop constraint proposal_measurement_groups_created_by_fkey,
  add constraint proposal_measurement_groups_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

alter table public.proposal_portal_links
  drop constraint proposal_portal_links_created_by_fkey,
  alter column created_by drop not null,
  add constraint proposal_portal_links_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null,
  drop constraint proposal_portal_links_revoked_by_fkey,
  add constraint proposal_portal_links_revoked_by_fkey foreign key (revoked_by) references auth.users (id) on delete set null;
