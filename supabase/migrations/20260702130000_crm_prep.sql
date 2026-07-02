-- Phase 1: CRM & Projects — preparation
--
-- 1. pg_trgm powers ILIKE/substring search indexes for clients/opportunities/projects
--    (see docs/16 in the original design and the Phase 1 search requirements) without
--    introducing an external search engine.
-- 2. tenant_memberships needs a UNIQUE(id, tenant_id) so Phase 1 tables can reference
--    an "assignee" via a composite foreign key (assigned_to, tenant_id) REFERENCES
--    tenant_memberships(id, tenant_id) — the same declarative, DB-level cross-tenant
--    guarantee used for every other Phase 1 relationship (see
--    docs/adr/0007-cross-tenant-integrity-via-composite-foreign-keys.md). This is an
--    additive constraint on an existing Phase 0 table via a NEW migration — the
--    original 20260701120500_tenant_memberships.sql migration is never edited.

create extension if not exists "pg_trgm" with schema extensions;

alter table public.tenant_memberships
  add constraint tenant_memberships_id_tenant_id_key unique (id, tenant_id);
