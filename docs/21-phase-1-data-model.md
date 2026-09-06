# 21 — Phase 1 Data Model

The 7 tables added in Phase 1, in dependency order. All migrations live in
`supabase/migrations/20260702130000` through `20260702131200`. See ADR
0007 for the cross-tenant integrity pattern used throughout, and ADR
0009/0010 for the assignee/archive column conventions.

## Entity relationship overview

```text
tenants
  └─ clients (tenant_id)
       ├─ client_contacts (client_id, tenant_id)
       ├─ opportunities (client_id, tenant_id; assigned_to → tenant_memberships)
       │    └─ projects (opportunity_id, tenant_id) — at most 1 per opportunity
       └─ projects (client_id, tenant_id; assigned_to → tenant_memberships)
            ├─ project_addresses (project_id, tenant_id)
            └─ primary_contact_id → client_contacts (tenant_id)

crm_notes         — client_id? / opportunity_id? / project_id? (exactly one)
crm_activities    — client_id? / opportunity_id? / project_id? (at least one)
```

## `clients`

A contractor's customer — person or business. **No `status` column**
(the commercial lifecycle lives in `opportunities.status`); a client is
simply active (`archived_at is null`) or archived.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid, FK → `tenants(id)` | |
| `client_type` | text | CHECK `in ('individual', 'business')` |
| `display_name` | text | required, non-blank |
| `legal_name`, `first_name`, `last_name`, `email`, `phone`, `secondary_phone`, `website`, `source` | text | all nullable |
| `tax_exempt` | boolean | default `false` |
| `preferred_contact_method` | text | CHECK `in ('email','phone','text')`, nullable |
| `created_by` | uuid, FK → `auth.users(id)` | |
| `archived_at`, `archived_by` | timestamptz / uuid | ADR 0010 simple variant |

`unique (id, tenant_id)` for downstream composite FKs. Indexes: partial
on `tenant_id` (active only), trigram GIN on `display_name` (search),
`(tenant_id, lower(email))` and `(tenant_id, phone)` (both partial,
non-null only).

## `client_contacts`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id`, `client_id` | uuid | composite FK → `clients (id, tenant_id)` |
| `first_name` | text | required |
| `last_name`, `job_title`, `email`, `phone`, `notes` | text | nullable |
| `preferred_contact_method` | text | CHECK, nullable |
| `is_primary` | boolean | default `false` |
| `archived_at`, `archived_by` | | |

`client_contacts_one_primary_per_client`: partial unique index on
`client_id` `WHERE is_primary = true AND archived_at is null` — the
declarative backstop behind `set_primary_contact()` (ADR 0013).

## `opportunities`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid, FK → `tenants(id)` | |
| `client_id` | uuid | composite FK → `clients (id, tenant_id)` |
| `title` | text | required, non-blank |
| `status` | text | CHECK, 8-value pipeline — see docs/22 |
| `pre_archive_status` | text | CHECK `in ('won','lost')`, nullable — ADR 0010 |
| `source` | text | nullable |
| `estimated_value_cents` | bigint | CHECK `>= 0`, nullable |
| `probability` | int | CHECK `between 0 and 100`, nullable |
| `expected_close_date` | date | nullable |
| `inspection_scheduled_at` | timestamptz | nullable |
| `lost_reason` | text | nullable, required when `status = 'lost'` (CHECK) |
| `assigned_to` | uuid | composite FK → `tenant_memberships (id, tenant_id)` — ADR 0009 |
| `created_by` | uuid, FK → `auth.users(id)` | |
| `archived_at`, `archived_by` | | |

`unique (id, tenant_id)`. Table-level CHECKs as defense-in-depth
alongside function-level validation:
`opportunities_lost_reason_required`,
`opportunities_inspection_date_required`.

## `projects`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid, FK → `tenants(id)` | |
| `client_id` | uuid | composite FK → `clients (id, tenant_id)`, required |
| `opportunity_id` | uuid | composite FK → `opportunities (id, tenant_id)`, nullable |
| `primary_contact_id` | uuid | composite FK → `client_contacts (id, tenant_id)`, nullable |
| `name` | text | required, non-blank |
| `service_type`, `description` | text | nullable |
| `status` | text | CHECK, 6-value pipeline — see docs/22 |
| `pre_archive_status` | text | CHECK, nullable |
| `assigned_to` | uuid | composite FK → `tenant_memberships (id, tenant_id)` |
| `inspection_scheduled_at` | timestamptz | nullable |
| `tentative_start_date` | date | nullable |
| `created_by`, `archived_at`, `archived_by` | | |

`unique (id, tenant_id)`. `projects_opportunity_id_key`: unique index on
`opportunity_id` `WHERE opportunity_id is not null` — at most one project
per opportunity, the declarative backbone of conversion idempotency (ADR
0013). `projects_inspection_date_required` CHECK mirrors the opportunity
equivalent.

## `project_addresses`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id`, `project_id` | uuid | composite FK → `projects (id, tenant_id)` |
| `address_line_1` | text | required |
| `address_line_2` | text | nullable |
| `city` | text | required |
| `state` | text | CHECK length 2–40 (lenient — supports non-US formats) |
| `postal_code` | text | CHECK regex `^[A-Za-z0-9 -]{3,12}$` |
| `country_code` | text | default `'US'`, CHECK length = 2 |
| `latitude`, `longitude` | numeric(9,6) | **always null** — no geocoding in Phase 1 |
| `access_instructions` | text | nullable |
| `is_primary` | boolean | default `false` |
| `created_by`, `archived_at`, `archived_by` | | |

`project_addresses_one_primary_per_project`: partial unique index,
same pattern as `client_contacts_one_primary_per_client`.

## `crm_notes`

Human-authored, mutable, archivable (no restore — see ADR 0010). See ADR
0008 for the "exclusive arc" pattern.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid, FK → `tenants(id)` | |
| `client_id`, `opportunity_id`, `project_id` | uuid | each nullable, each with its own composite FK; `crm_notes_exactly_one_parent` CHECK requires exactly one set |
| `body` | text | required, non-blank |
| `created_by`, `archived_at`, `archived_by` | | |

## `crm_activities`

System-generated, append-only (trigger-enforced — even `service_role`
cannot UPDATE/DELETE). Never written directly by a client; only by
`log_crm_activity()`, called internally by the mutation functions.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid, FK → `tenants(id)` | |
| `client_id`, `opportunity_id`, `project_id` | uuid | each nullable, each with its own composite FK; `crm_activities_at_least_one_parent` CHECK |
| `activity_type` | text | CHECK against a fixed 20-value list (e.g. `opportunity_won`, `inspection_scheduled`, `project_created`) |
| `actor_user_id` | uuid, FK → `auth.users(id)` | nullable — reserved for a future system-originated activity with no human actor |
| `metadata` | jsonb | non-sensitive descriptive data only (e.g. `{"from_status": "new", "to_status": "contacted"}`) — never secrets, verified by `tests/rls/phase1-crm.test.ts` |
| `created_at` | timestamptz | |

## Database functions added in Phase 1

| Function | Type | Purpose |
|---|---|---|
| `is_active_member_of_tenant(uuid, uuid)` | Helper, `SECURITY DEFINER` | Is this membership id an active member of this tenant? Used to validate assignees. |
| `log_crm_activity(...)` | `SECURITY DEFINER`, internal only (no grant to `authenticated`) | Sole write path for `crm_activities`, mirrors `log_audit_event()` |
| `create_client` / `update_client` / `archive_client` / `restore_client` | `SECURITY DEFINER` | Client CRUD |
| `create_client_contact` / `update_client_contact` / `set_primary_contact` / `archive_client_contact` / `restore_client_contact` | `SECURITY DEFINER` | Contact CRUD + concurrency-safe primary switch |
| `create_opportunity` / `update_opportunity` / `change_opportunity_status` / `archive_opportunity` / `restore_opportunity` | `SECURITY DEFINER` | Opportunity CRUD + state machine |
| `create_project` / `update_project` / `change_project_status` / `archive_project` / `restore_project` | `SECURITY DEFINER` | Project CRUD + state machine |
| `convert_opportunity_to_project` | `SECURITY DEFINER` | Atomic, idempotent conversion — ADR 0011, 0013 |
| `create_project_address` / `update_project_address` / `set_primary_project_address` / `archive_project_address` / `restore_project_address` | `SECURITY DEFINER` | Address CRUD + concurrency-safe primary switch |
| `create_note` / `update_note` / `archive_note` | `SECURITY DEFINER` | Note CRUD (no restore — ADR 0010) |

Every function above sets `search_path = public, pg_temp` explicitly,
derives the actor exclusively from `auth.uid()`, validates its target
row belongs to the tenant it claims, checks the specific permission key
for the operation, and has `EXECUTE` revoked from `PUBLIC`/`anon`,
granted only to `authenticated` — the same discipline established in
Phase 0 (see `docs/18-phase-0-security-hardening.md`).
