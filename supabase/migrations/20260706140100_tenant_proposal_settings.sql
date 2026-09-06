-- Phase 2A: Proposal-centric pivot — tenant-level proposal defaults.
--
-- One row per tenant (tenant_id is both PK and the tenant scope — no
-- separate `id` needed, mirrors business_profiles-style 1:1 tables).
-- `next_proposal_number` is advanced exclusively by
-- `allocate_next_proposal_number()` under a row lock (see
-- 20260706141000_proposal_helpers.sql) — there is no direct UPDATE grant
-- that could let a client set it arbitrarily.
--
-- Money: cents (bigint). Percentages: basis points (int, 0-10000). Currency
-- is restricted to USD in Phase 2A — see docs/adr/0031-tax-and-discount-model.md
-- and docs/39 (Proposal Settings) for why changing currency after proposals
-- exist is out of scope rather than silently allowed.

create table public.tenant_proposal_settings (
  tenant_id uuid primary key references public.tenants (id),
  currency_code text not null default 'USD' check (currency_code = 'USD'),
  default_customer_hourly_rate_cents bigint not null default 3500 check (default_customer_hourly_rate_cents >= 0),
  default_hours_per_day numeric(5,2) not null default 8 check (default_hours_per_day > 0),
  default_tax_rate_bps int not null default 0 check (default_tax_rate_bps between 0 and 10000),
  default_proposal_valid_days int not null default 30 check (default_proposal_valid_days > 0),
  default_terms text not null default '',
  default_exclusions text not null default '',
  proposal_number_prefix text not null default 'PRO' check (btrim(proposal_number_prefix) <> ''),
  next_proposal_number int not null default 1 check (next_proposal_number >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tenant_proposal_settings is
  'One row per tenant, created lazily/idempotently by ensure_tenant_proposal_settings() the first time it is needed. next_proposal_number is only ever advanced by allocate_next_proposal_number() under FOR UPDATE — never editable directly (see docs/30-phase-2a-proposal-data-model.md).';

create trigger trg_tenant_proposal_settings_set_updated_at
  before update on public.tenant_proposal_settings
  for each row execute function public.set_updated_at();
