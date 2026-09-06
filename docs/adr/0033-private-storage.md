---
status: Accepted
date: 2026-07-06
supersedes: none
---

# ADR 0033 — Private Storage bucket for media

## Context

Proposal and Portfolio photos are business-sensitive (unreleased pricing
context, client property photos) and must never be publicly reachable by
guessing or enumerating a URL, while still being fast to display to an
authorized user in the app.

## Decision

One bucket, `scopevia-media`, created with `public = false`,
`file_size_limit = 10485760` (10 MB), and
`allowed_mime_types = ['image/jpeg', 'image/png', 'image/webp']` — all
enforced by Storage itself, not just application code
(`supabase/migrations/20260706141700_proposal_storage.sql`).

**Path convention:** `<tenant_id>/<media_id>/original.<ext>` — both
segments are UUIDs, never a user's name/email, so the path itself carries
no PII. RLS policies on `storage.objects` derive the tenant from the
path's first segment via `storage.foldername()` and check it against
`user_has_permission()` — the identical authorization model used
everywhere else in the app, applied to Storage instead of a table's
`tenant_id` column. A `try_parse_uuid()` helper makes a malformed/
manipulated path segment evaluate to **denied**, not a hard Postgres
error, so a crafted path can't produce a confusing 500 or leak anything
via an error message.

**No public URLs, ever.** The application only ever requests a signed
URL with a short expiry (`src/lib/storage/media.ts`,
`getSignedMediaUrl`/`getSignedMediaUrls`, default 300s) — verified
directly: `tests/rls/phase2a-storage.test.ts`, "no public URL is usable"
fetches the bucket's own `getPublicUrl()` result and confirms it 404s/
403s, while a freshly created signed URL succeeds.

**No DELETE policy.** Media rows and their Storage objects are archived,
not hard-deleted, by any user-facing action — hard deletion is a future
manual/operational concern, not implemented in Phase 2A.

## Consequences

- Verified against the real `scopevia-media` bucket on the dedicated
  `scopevia-test` project (not mocked): valid JPEG/PNG/WebP upload,
  oversized rejection, wrong-MIME rejection, cross-tenant upload/
  download/list all rejected, Viewer cannot upload, Field Worker can
  (their explicit permission), path manipulation rejected, signed URL
  works, public URL doesn't — 14/14 tests in
  `tests/rls/phase2a-storage.test.ts`.
- `register_media_asset()` independently re-validates MIME/size/tenant-
  path-prefix server-side — Storage's bucket-level policy is the primary
  control, this is defense in depth, not the only check.
