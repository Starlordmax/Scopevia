-- AI-assisted proposal text (Terms/Exclusions/Notes) — tenant-level
-- business context that feeds the AI prompt.
--
-- One row per tenant (tenant_id is both PK and the tenant scope), created
-- lazily/idempotently by ensure_business_profile() the first time it's
-- needed — same "1:1 settings table" shape as tenant_proposal_settings
-- (20260706140100_tenant_proposal_settings.sql), NOT extra columns on
-- `tenants` (unlike business_branding's logo columns): this table has a
-- much larger, business-content-shaped field set (policies, tone,
-- descriptions) that doesn't belong mixed into the tenant identity row.
--
-- This is deliberately NOT gated by a new permission — it reuses
-- tenant.view/tenant.update (see 20260819100200_business_profiles_rls.sql),
-- matching business_branding's precedent: this is "more tenant settings,"
-- not a distinct capability. Contrast with ai.generate_proposal_text
-- (20260819100500_seed_ai_permissions.sql), which IS a new permission
-- because it's an action/cost-bearing capability, not just visibility.
--
-- See docs/78-business-profile-ai-context.md.

create table public.business_profiles (
  tenant_id uuid primary key references public.tenants (id),
  business_name text not null default '',
  industry text not null default '',
  main_services text not null default '',
  service_area text not null default '',
  business_address text not null default '',
  business_phone text not null default '',
  business_email text not null default '',
  license_number text not null default '',
  insurance_statement text not null default '',
  default_warranty_policy text not null default '',
  default_payment_terms text not null default '',
  default_deposit_policy text not null default '',
  default_change_order_policy text not null default '',
  default_cancellation_policy text not null default '',
  default_cleanup_policy text not null default '',
  default_materials_policy text not null default '',
  default_client_responsibilities text not null default '',
  default_exclusions text not null default '',
  tone_preference text not null default 'professional'
    check (tone_preference in ('professional', 'friendly', 'direct', 'detailed', 'simple')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.business_profiles is
  'One row per tenant, created lazily/idempotently by ensure_business_profile(). Feeds the AI proposal-text prompt (see src/lib/ai/prompt.ts) and is shown/edited in Profile → Business profile. Never stores prompts, AI responses, or secrets — see ai_generation_events for generation telemetry.';

create trigger trg_business_profiles_set_updated_at
  before update on public.business_profiles
  for each row execute function public.set_updated_at();
