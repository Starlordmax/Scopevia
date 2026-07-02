-- Phase 0: Foundations
-- Append-only audit trail. No UPDATE/DELETE is permitted through any path —
-- not RLS, not the table owner — enforced by the trigger below in addition to
-- simply never granting UPDATE/DELETE privileges.

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: some events (auth.signed_in/out before a tenant is chosen) are
  -- not scoped to a tenant.
  tenant_id uuid references public.tenants (id) on delete cascade,
  -- Nullable + ON DELETE SET NULL: reserved for future system/webhook-originated
  -- events that have no human actor, AND to guarantee that deleting a user's
  -- account can never be blocked by (or cascade into deleting) their audit
  -- history — the log row must survive with an anonymized actor reference.
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

comment on table public.audit_logs is
  'Append-only audit trail. Inserted only via log_audit_event(); never mutated. Sensitive-action audit rows (tenant.created, membership.*) are written inside the same DB transaction as the action itself, so they can never silently go missing.';

create index audit_logs_tenant_id_created_at_idx on public.audit_logs (tenant_id, created_at desc);
create index audit_logs_actor_user_id_idx on public.audit_logs (actor_user_id);

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'audit_logs is append-only: % is not permitted', tg_op;
end;
$$;

comment on function public.prevent_audit_log_mutation() is
  'Defense in depth: blocks UPDATE/DELETE on audit_logs even for roles that bypass RLS (e.g. table owner, service_role using raw SQL).';

create trigger trg_audit_logs_no_update
  before update on public.audit_logs
  for each row execute function public.prevent_audit_log_mutation();

create trigger trg_audit_logs_no_delete
  before delete on public.audit_logs
  for each row execute function public.prevent_audit_log_mutation();
