-- Phase 0: Foundations
-- `profiles` is a public, application-owned mirror of `auth.users` for the
-- non-credential fields we need to join against in RLS policies and UI.
-- Supabase Auth (auth.users) remains the single source of truth for identity
-- and credentials; we never duplicate email/password here.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  locale text not null default 'en-US',
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Application profile for an authenticated user. 1:1 with auth.users. Created automatically by the on_auth_user_created trigger (see auth_and_tenant_functions migration).';

create trigger trg_profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
