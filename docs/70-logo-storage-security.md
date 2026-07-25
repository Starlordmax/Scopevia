# 70 — Logo Storage Security (Phase 3D.2)

Companion to [docs/69](69-business-branding-logo-upload.md). Covers the
`tenant-branding` Storage bucket, its RLS policies, file-type/size
enforcement, and the specific cross-tenant threats this phase had to
defend against — the same review depth as
[docs/33](33-media-and-storage-security.md) (media) and
[docs/53](53-client-portal-security.md) (portal).

## Bucket configuration

`tenant-branding` — created in
`supabase/migrations/20260723100100_tenant_branding_storage.sql`:

- **Private** (`public = false`). Never toggled public.
- **10 MB file size limit**, enforced by Supabase Storage itself (not just
  application code) — `file_size_limit = 10485760`. Raised from an initial
  2 MB (migration `20260724100600_tenant_branding_10mb_limit.sql`) to
  match this app's other already-shipped upload limit
  (`scopevia-media`'s 10 MB job/portfolio photos) — see
  [docs/71](71-logo-upload-crash-fix.md).
- **Allowed MIME types**: `image/png`, `image/jpeg`, `image/webp` only,
  also enforced at the bucket level via `allowed_mime_types`.

This is a *separate* bucket from `scopevia-media` (Phase 2A's photo
gallery bucket), deliberately: a logo is a single tenant-identity asset
with its own permission model (`tenant.view`/`tenant.update`, not
`media.view`/`media.upload`), not another item in the proposal-photos
gallery — the size limit now happens to match `scopevia-media`'s, but the
buckets remain otherwise independent.

## Why SVG is blocked, not sanitized

The brief's own MVP recommendation, applied as-is: **SVG is excluded from
`allowed_mime_types` entirely.** An SVG file can embed `<script>` tags,
external resource references, and CSS that isn't stoppable by MIME/size
checks alone — properly neutralizing that requires a real sanitization
pass (stripping scripts/event handlers/external refs), which is
explicitly out of scope for this phase (see docs/69, "Known
limitations"). Blocking the type outright at the bucket level is the safe
default until that sanitization work is deliberately scheduled.

## Path convention and RLS policies

Path: `<tenant_id>/logo-<uuid>.<ext>` — identical
tenant-id-is-the-first-folder-segment convention as `scopevia-media`, so
the same `storage.foldername()`-based policy shape applies unchanged
(reusing `public.try_parse_uuid()` from Phase 2A, which safely returns
null instead of raising on a malformed segment — a manipulated path
resolves to **denied**, never a hard error).

| Policy | Operation | Permission checked |
|---|---|---|
| `tenant_branding_select` | SELECT | `tenant.view` on the path's tenant id |
| `tenant_branding_insert` | INSERT | `tenant.update` on the path's tenant id |
| `tenant_branding_update` | UPDATE | `tenant.update` on the path's tenant id |
| `tenant_branding_delete` | DELETE | `tenant.update` on the path's tenant id |

**Unlike `scopevia-media`** (which has no DELETE policy — proposal photos
are archived, never hard-deleted), `tenant-branding` **does** allow
DELETE. A logo isn't an append-only historical record the way a proposal
photo attached to a specific version is; replacing or removing it should
actually free the old object, not accumulate storage garbage on every
replacement. `uploadBusinessLogoAction()`/`removeBusinessLogoAction()`
(`src/actions/branding.ts`) delete the previous object only *after* the
new DB pointer write (on replace) or the DB clear (on remove) has already
succeeded — so a failure partway through a replace never leaves the
tenant pointing at a file that's already gone.

## Why the portal uses the service-role admin client

`getSignedBrandingUrlForPortal()` (`src/lib/storage/branding.ts`) uses
`createAdminClient()` instead of the caller's own session — because a
client portal visitor has **no Supabase Auth session at all**. The
ordinary `tenant_branding_select` policy (`to authenticated`, gated on
`tenant.view`) can never be satisfied by an anonymous visitor, so the
normal signing path would silently return no logo for every portal page.

This is safe for the exact same reason
`getSignedMediaUrlsForPortal()` (Phase 2A/3A) is safe: the only caller
(`src/app/p/[token]/view/page.tsx`, `src/app/p/[token]/print/page.tsx`)
only ever passes a `logo_storage_path` that was just read from the
`tenants` row belonging to `session.tenant_id` — and `session.tenant_id`
itself was just authoritatively resolved by `portal_get_session_context()`
for *this exact token*, never supplied by the visitor. There is no code
path where a visitor's own input selects which tenant's logo gets signed.

## update_tenant_branding()'s own defense in depth

Beyond the Storage INSERT policy, `update_tenant_branding()` independently
re-validates on the database side before writing:

- `p_logo_storage_path` must start with `<p_tenant_id>::text || '/'` —
  rejects a path claiming to belong to a different tenant, even if
  somehow called with a mismatched path.
- `p_logo_content_type` must be one of the three allowed MIME types.
- `p_logo_size_bytes` must be in `(0, 10485760]`.

This mirrors `register_media_asset()`'s own independent re-check in Phase
2A — the Storage bucket's own enforcement and the database function's
enforcement are two separate layers, neither trusting the other alone.

## Threats covered (and tests that verify each one)

All of the following are exercised by real requests against
`scopevia-test` in `tests/rls/phase3d2-branding.test.ts` (20 tests) — not
mocked:

| Threat | Defense | Verified by |
|---|---|---|
| Tenant A uploads to Tenant B's path | `tenant_branding_insert` policy | "Tenant A cannot upload under Tenant B's branding path" |
| Tenant A downloads Tenant B's logo object | `tenant_branding_select` policy | "Tenant A cannot download Tenant B's logo object" |
| A user without `tenant.update` uploads/replaces/removes | Storage policies + `update_tenant_branding()`/`remove_tenant_branding()`'s own permission check | Estimator/Viewer upload + RPC-call tests |
| A non-member of the tenant calls the RPCs directly | `user_has_permission()` returns false for a non-member | "Tenant B's owner cannot read or update Tenant A's branding" |
| Oversized file | Bucket `file_size_limit` | "an oversized file is rejected by the bucket's file_size_limit" |
| Disallowed file type (e.g. SVG) | Bucket `allowed_mime_types` | "an unsupported MIME type (e.g. SVG) is rejected" |
| The logo is served as a public URL | Bucket is private; `getPublicUrl()` is unreachable | "no public URL is usable for a logo" |
| Storage path spoofing via `update_tenant_branding()` | The function's own prefix check | "rejects a storage path that does not start with the caller's own tenant id" |
| Removing Tenant A's logo deletes Tenant B's object | Deletion always targets the specific previously-read path, scoped by tenant | "removing Tenant A's logo never touches Tenant B's own logo object" |

## Storage path is never exposed to the client

`getBusinessBranding()` and `getSignedBrandingUrl*()`
(`src/lib/branding/data.ts`, `src/lib/storage/branding.ts`) only ever
return a short-lived (5-minute) signed URL or `null` — never the raw
`logo_storage_path`. The only code that reads the raw path is
server-only: `getBusinessLogoStoragePath()`, used exclusively inside
`src/actions/branding.ts` to know which object to delete after a
replace/remove.
