-- AI-assisted proposal text — generation telemetry / rate-limit /
-- cost-observability log. Append-only, same discipline as audit_logs
-- (20260701120600_audit_logs.sql), but a DEDICATED table rather than
-- reusing audit_logs: this needs a shape audit_logs doesn't have (model,
-- status, token counts) and needs to support a fast per-tenant/per-user
-- "how many in the last hour" COUNT query for rate limiting
-- (count_recent_ai_generations(), see the functions migration).
--
-- Deliberately does NOT store the prompt or the raw AI response — see
-- docs/79-openrouter-security.md and docs/10-ai-boundaries.md's data
-- minimization principle. `error_code` is a short, sanitized code
-- (e.g. "missing_api_key", "invalid_json", "rate_limited", "timeout"),
-- never a raw provider error string.

create table public.ai_generation_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- Nullable + ON DELETE SET NULL: same reasoning as audit_logs.actor_user_id
  -- -- deleting a user's account must never be blocked by, or cascade
  -- into deleting, generation history.
  user_id uuid references auth.users (id) on delete set null,
  proposal_id uuid references public.proposals (id) on delete set null,
  proposal_version_id uuid references public.proposal_versions (id) on delete set null,
  feature text not null check (feature in ('terms', 'exclusions', 'client_notes', 'all')),
  model text not null,
  status text not null check (status in ('success', 'error')),
  error_code text,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);

comment on table public.ai_generation_events is
  'Append-only AI generation telemetry -- inserted only via record_ai_generation_event(), never mutated. Never stores the prompt or raw AI response (see docs/79-openrouter-security.md). Used for both cost/usage observability and per-user-per-tenant rate limiting (count_recent_ai_generations()).';

create index ai_generation_events_tenant_user_created_at_idx
  on public.ai_generation_events (tenant_id, user_id, created_at desc);
create index ai_generation_events_proposal_id_idx
  on public.ai_generation_events (proposal_id);

create or replace function public.prevent_ai_generation_event_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'ai_generation_events is append-only: % is not permitted', tg_op;
end;
$$;

comment on function public.prevent_ai_generation_event_mutation() is
  'Defense in depth: blocks UPDATE/DELETE on ai_generation_events even for roles that bypass RLS.';

create trigger trg_ai_generation_events_no_update
  before update on public.ai_generation_events
  for each row execute function public.prevent_ai_generation_event_mutation();

create trigger trg_ai_generation_events_no_delete
  before delete on public.ai_generation_events
  for each row execute function public.prevent_ai_generation_event_mutation();
