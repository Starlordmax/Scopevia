-- Phase 0: Foundations
-- Generic helpers with no dependency on domain tables.

-- Keeps `updated_at` accurate on every UPDATE. Attached per-table below.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger function: stamps NEW.updated_at = now() on every UPDATE.';
