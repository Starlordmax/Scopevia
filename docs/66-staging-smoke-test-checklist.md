# 66 — Staging Smoke Test Checklist (Phase 3D.1)

Status: **Manual checklist, to run once after every deploy to Render
staging before telling any tester the environment is ready.** Exercises
every phase built so far, end to end, against real infrastructure (real
Supabase, real Resend email) — this is intentionally broader than any
single automated test, and is meant to be run by a human clicking through
the real Render URL.

## Before you start

- [ ] Confirm the Render deploy succeeded and `/api/health` returns
      `{"ok": true, ...}` (open it directly in a browser).
- [ ] Confirm `EMAIL_PROVIDER=resend` on the Render service (never `dev`
      for a deployment testers can reach) — see
      [docs/65](65-render-environment-variables.md).
- [ ] Have a real, reachable inbox ready for the "client" side of the
      portal flow (a personal email you control) — Resend will send a
      real code to it.

## 1. Internal contractor flow

- [ ] Open the Render URL.
- [ ] Sign in with a tester account (see [docs/64](64-render-staging-deployment.md), "Tester access plan," in the final report).
- [ ] Create a client.
- [ ] Create a proposal for that client.
- [ ] Fill in the scope/summary step.
- [ ] Add a measurement (manual entry).
- [ ] Add a material (from the catalog or a custom line item).
- [ ] Add a labor item.
- [ ] Upload a current-job photo.
- [ ] Mark the proposal ready.
- [ ] Create a client portal link — confirm the URL shown uses the Render
      staging domain, not `localhost`.
- [ ] Open the internal print/export route (`/proposals/[id]/print`) —
      confirm it renders cleanly with a working "Print / Save as PDF"
      button.

## 2. Portal flow (as the client)

- [ ] Open the portal link from step 1 in an incognito/private window.
- [ ] Enter the authorized client email.
- [ ] **Check the real inbox — confirm a real Resend email with a 6-digit
      code actually arrives** (this is the one step that can never be
      verified by an automated test — see [docs/62](62-proposal-email-notifications.md)).
- [ ] Enter the code, confirm the proposal view loads.
- [ ] Open the portal print/export route — confirm it renders cleanly.
- [ ] Accept the proposal.
- [ ] **Back in the contractor's own inbox, confirm a "Proposal accepted"
      notification email arrives** — see
      [docs/62](62-proposal-email-notifications.md).
- [ ] Back in the contractor app, confirm the proposal now shows
      "Accepted."

## 3. Revision flow

- [ ] Create a second proposal (repeat the relevant parts of step 1).
- [ ] As the client, decline it with a reason.
- [ ] As the contractor, confirm the declined reason is visible.
- [ ] Click "Create revised version."
- [ ] Mark the new version ready.
- [ ] Create a new portal link.
- [ ] Open the **old** portal link — confirm it still shows the old,
      declined version's content.
- [ ] Open the **new** portal link — confirm it shows the new, revised
      content with no response recorded yet.

## What a failure here means

This checklist exercises real Supabase RLS, real Resend delivery, and
real Render-hosted cookies together for the first time — something no
automated suite in this repo can fully replicate (RLS/E2E tests always run
against `EMAIL_PROVIDER=dev`, never a real send — see
[docs/62](62-proposal-email-notifications.md), "No real Resend send
exercised in any automated test"). A failure anywhere in this list means
**do not invite testers yet** — see [docs/64](64-render-staging-deployment.md)
and the final report's "Rollback plan."
