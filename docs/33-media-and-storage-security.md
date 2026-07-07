# 33 — Media and Storage Security

Status: **Implemented and verified against the real `scopevia-media`
bucket** on the dedicated `scopevia-test` Supabase project — 14/14 tests
in `tests/rls/phase2a-storage.test.ts`, all exercising real uploads/
downloads/signed URLs, not mocked. See
[docs/adr/0032](adr/0032-media-asset-model.md) and
[docs/adr/0033](adr/0033-private-storage.md).

## Bucket

`scopevia-media` — **private** (`public = false`), 10 MB file size limit,
`image/jpeg` / `image/png` / `image/webp` only, all enforced by Supabase
Storage itself
(`supabase/migrations/20260706141700_proposal_storage.sql`), not only by
application code.

## Path convention

`<tenant_id>/<media_id>/original.<ext>` — both segments are
server-generated UUIDs. The tenant id is never derived from a name/email,
so the path carries no PII, and it's exactly what the Storage RLS
policies check against the caller's own tenant membership.

## Storage RLS policies

Three policies on `storage.objects` (`scopevia_media_select`,
`_insert`, `_update`), each requiring `bucket_id = 'scopevia-media'` and
`user_has_permission(tenant_from_path, <media permission>)` — the same
authorization primitive used by every table in this project, applied to
Storage. `try_parse_uuid()` makes a malformed or manipulated path segment
evaluate to **denied**, never a raw Postgres error that could produce a
confusing 500 or leak information. No `DELETE` policy exists — objects
are archived at the `media_assets` row level, never hard-deleted by any
user action.

## `media_assets` — the metadata anchor

A `media_assets` row is only ever created by `register_media_asset()`,
called **after** the Storage upload already succeeded — this table is
never the source of truth for whether a file exists, Storage is.
`register_media_asset()` independently re-validates MIME type, size, and
that the storage path's tenant prefix matches the caller's own tenant —
redundant with the bucket's own policy, deliberate defense in depth, per
the brief's explicit instruction not to rely on a single check.

`media_type` (`current_job` | `portfolio` | `general`) categorizes the
file independent of where it's used; the actual usage (which proposal, or
which portfolio project) lives in the join tables
(`proposal_media`, `portfolio_project_media` — see
[docs/30](30-phase-2a-proposal-data-model.md)).

## Signed URLs only

The application never generates or stores a public URL.
`src/lib/storage/media.ts` (`getSignedMediaUrl`/`getSignedMediaUrls`)
requests a signed URL with a 300-second default expiry every time a photo
needs to be displayed. Verified directly: a bucket-generated
`getPublicUrl()` result 404s/403s when actually fetched, while a signed
URL succeeds (`tests/rls/phase2a-storage.test.ts`).

## Upload flow

1. Client submits a file via a plain `<input type="file">` inside a
   Server Action form (`uploadCurrentJobPhotoAction` /
   `uploadPortfolioPhotoAction`).
2. `uploadMediaFile()` (`src/lib/storage/media.ts`) validates MIME/size
   client-side-of-the-server (i.e. in the Server Action, before any
   network call — a cheap early rejection, not the security boundary),
   generates a UUID path, and uploads using the **caller's own session**
   — never `service_role` — so the Storage RLS policies are the real
   gate for the upload itself.
3. On success, `register_media_asset()` is called to create the metadata
   row. On failure, the just-uploaded Storage object is removed
   (best-effort cleanup of an orphan) before returning a friendly error.

## Permission matrix (Storage-relevant keys)

| Permission | Owner | Admin | Estimator | Sales | Field Worker | Viewer |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `media.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `media.upload` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| `media.update` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `media.archive` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

Field Worker's `media.upload` is deliberate — they can add current-job
photos in the field without needing pricing or general edit rights (see
`docs/27` of the brief and the seed migration's module comment).

## What was verified empirically, not just by policy review

Per the brief's explicit instruction not to declare Storage security PASS
based on policy review alone: `tests/rls/phase2a-storage.test.ts` performs
real uploads of a valid 1×1 PNG, a real oversized buffer (rejected by the
bucket's own `file_size_limit`), a real `text/plain` upload (rejected by
`allowed_mime_types`), real cross-tenant upload/download/list attempts,
a real Viewer upload attempt, a real Field Worker upload, a real fetch of
a `getPublicUrl()` result, a real signed URL fetch, a real path-traversal
attempt, and a real `register_media_asset()` call with a cross-tenant
path.
