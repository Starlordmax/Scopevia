-- AI-assisted proposal text — ai_generation_events RLS.
-- SELECT-only (own-tenant, ai.generate_proposal_text-gated -- lets a
-- future "usage this month" UI read it), no insert/update/delete grant --
-- every write goes through record_ai_generation_event(), and mutation is
-- additionally blocked by the append-only triggers in the schema migration.

alter table public.ai_generation_events enable row level security;
create policy ai_generation_events_select on public.ai_generation_events
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'ai.generate_proposal_text'));
grant select on public.ai_generation_events to authenticated;
