---
status: Accepted
date: 2026-07-01
supersedes: none
---

# ADR 0001 — Multi-tenant database strategy

## Context

Scopevia must isolate each contractor business ("tenant") from every other
tenant's data, from the very first table created. See
[docs/04-system-architecture.md](../04-system-architecture.md) and
[docs/06-security-and-rls.md](../06-security-and-rls.md) for the
Phase-0-agnostic version of this decision made during the design phase.

## Decision

Shared database, shared schema. Every tenant-owned table carries a `tenant_id`
(directly, or desnormalized from its parent when it hangs off another
tenant-owned table). Isolation is enforced by PostgreSQL Row Level Security,
not by application-level filtering alone, and not by separate schemas or
databases per tenant.

## Consequences

- Cheap to operate at Phase-0/MVP scale: one Postgres instance per
  environment, one set of migrations.
- RLS policies are the actual security boundary — they must be tested as
  rigorously as any other security-critical code (see
  [docs/17-rls-verification.md](../17-rls-verification.md)).
- Every new tenant-owned table added in later phases MUST get an RLS policy
  in the same migration that creates it — there is no "temporarily disable
  RLS for development" escape hatch (explicitly forbidden, see
  [docs/14-phase-0-foundations.md](../14-phase-0-foundations.md)).
- Schema-per-tenant or database-per-tenant remain available as a future
  migration path if a specific enterprise customer requires stronger
  physical isolation, but are not needed at this scale.
