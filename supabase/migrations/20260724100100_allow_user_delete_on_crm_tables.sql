-- Fix: several created_by/uploaded_by/actor_user_id foreign keys to
-- auth.users had no ON DELETE behavior (Postgres default NO ACTION),
-- so deleting a user's auth account failed with a 23503 foreign key
-- violation for any user who had ever created a client, opportunity,
-- CRM note, or media asset -- discovered while bulk-deleting test/E2E
-- fixture users on scopevia-test. Mirrors the pattern already used by
-- tenants.created_by and audit_logs.actor_user_id: on delete set null,
-- so deleting a user's account never requires first deleting or
-- reassigning their historical records. Application code that reads
-- these columns already degrades gracefully for an unknown/missing
-- author (e.g. src/lib/crm/notes-data.ts falls back to "Team member").
--
-- crm_activities.actor_user_id was already nullable; the other four
-- columns are relaxed from NOT NULL since a column referenced ON DELETE
-- SET NULL must itself be nullable.

alter table public.clients
  drop constraint clients_created_by_fkey,
  alter column created_by drop not null,
  add constraint clients_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

alter table public.opportunities
  drop constraint opportunities_created_by_fkey,
  alter column created_by drop not null,
  add constraint opportunities_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

alter table public.crm_notes
  drop constraint crm_notes_created_by_fkey,
  alter column created_by drop not null,
  add constraint crm_notes_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

alter table public.media_assets
  drop constraint media_assets_uploaded_by_fkey,
  alter column uploaded_by drop not null,
  add constraint media_assets_uploaded_by_fkey foreign key (uploaded_by) references auth.users (id) on delete set null;

alter table public.crm_activities
  drop constraint crm_activities_actor_user_id_fkey,
  add constraint crm_activities_actor_user_id_fkey foreign key (actor_user_id) references auth.users (id) on delete set null;
