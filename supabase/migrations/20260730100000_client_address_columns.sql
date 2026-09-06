-- Adds an optional address to `clients`, reusing the exact column names
-- and lenient (international-ready) postal_code pattern already
-- established by `project_addresses` (20260702130300_projects_and_addresses.sql)
-- rather than inventing new conventions. Unlike project_addresses (a
-- child table, since a project can genuinely have several work-site
-- addresses), a client has at most ONE address in this phase — no
-- multi-address management UI is being added — so this is deliberately
-- Option A from the brief (plain columns on `clients`), not a new
-- `client_addresses` table. See docs/73-client-address-and-material-zip-defaults.md.
--
-- Every column is independently nullable: a client may have partial or no
-- address info at all. `website` is untouched -- kept in the schema
-- (existing data, if any, is preserved) even though it's being removed
-- from the create-client UI; see that doc for the full rationale.

alter table public.clients
  add column address_line_1 text,
  add column address_line_2 text,
  add column city text,
  add column state text,
  add column postal_code text,
  add column country_code text;

alter table public.clients
  add constraint clients_state_check
    check (state is null or char_length(btrim(state)) between 2 and 40);

alter table public.clients
  add constraint clients_postal_code_check
    check (postal_code is null or postal_code ~ '^[A-Za-z0-9 -]{3,12}$');

alter table public.clients
  add constraint clients_country_code_check
    check (country_code is null or char_length(country_code) = 2);

comment on column public.clients.postal_code is
  'The client/job address ZIP or postal code -- lenient, international-ready format (see project_addresses for the same pattern). Used as the DEFAULT pricing ZIP for a new proposal''s Materials & Costs step (see create_proposal_direct()/create_initial_proposal_version()) when it looks like a valid 5-digit US ZIP; never blocks proposal creation if it does not.';
