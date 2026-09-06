-- Phase 2A: Proposal-centric pivot — proposal_line_items (materials & other
-- costs). line_total_cents is always server-computed
-- (round(quantity * unit_price_cents)) — never accepted from the client.
-- section_id is optional: a line item can exist without belonging to a
-- specific scope section (e.g. a generic "Materials & Costs" bucket).

create table public.proposal_line_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  proposal_version_id uuid not null,
  section_id uuid,
  category text not null check (category in (
    'material', 'equipment', 'subcontractor', 'travel', 'disposal',
    'additional_service', 'allowance', 'other'
  )),
  description text not null check (btrim(description) <> ''),
  quantity numeric(12,3) not null check (quantity > 0 and quantity <= 1000000),
  unit text not null check (unit in ('each', 'hour', 'day', 'gallon', 'sq_ft', 'linear_ft', 'fixed')),
  unit_price_cents bigint not null check (unit_price_cents >= 0 and unit_price_cents <= 100000000),
  line_total_cents bigint not null default 0 check (line_total_cents >= 0),
  taxable boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, tenant_id),
  foreign key (proposal_version_id, tenant_id) references public.proposal_versions (id, tenant_id),
  foreign key (section_id, tenant_id) references public.proposal_sections (id, tenant_id)
);

comment on table public.proposal_line_items is
  'A material/equipment/subcontractor/other cost line within a proposal_version. Quantity must be > 0 — Phase 2A found no justified case for a zero-quantity line item (see docs/32-proposal-calculation-engine.md); if one is needed later it should be an explicit "allowance" row with a real quantity, not zero. line_total_cents is always server-computed.';

create index proposal_line_items_version_idx on public.proposal_line_items (proposal_version_id, sort_order) where archived_at is null;
create index proposal_line_items_section_idx on public.proposal_line_items (section_id) where section_id is not null;

create trigger trg_proposal_line_items_set_updated_at
  before update on public.proposal_line_items
  for each row execute function public.set_updated_at();

create trigger trg_proposal_line_items_prevent_locked_mutation
  before insert or update or delete on public.proposal_line_items
  for each row execute function public.prevent_locked_version_child_mutation();
