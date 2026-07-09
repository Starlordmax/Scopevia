-- Phase 2B: Material catalog & ZIP pricing — demo/seed data.
--
-- ALL data in this migration is fictional demo data (docs/42-material-catalog-by-zip.md,
-- "Known limitations"): "Demo Supplier" is a generic placeholder, not a
-- real brand, and prices are reasonable but invented. No scraping, no
-- real Home Depot/Lowe's/Sherwin-Williams data, no external API of any
-- kind — exactly as scoped for this phase. 26 global materials across
-- paint, bathroom remodeling, and flooring, priced for 4 demo ZIPs:
-- 33101 (Miami, FL), 78701 (Austin, TX), 90001 (Los Angeles, CA), 10001
-- (New York, NY).
--
-- Deliberately uneven price coverage to exercise every fallback tier in
-- find_material_zip_price() (see 20260708120400_material_catalog_functions.sql):
-- most items have all 4 ZIP prices; "Waterproof Membrane" has only a
-- state-level FL price (tier 2); "Sandpaper Pack" and "Floor Transition
-- Strip" have only a ZIP/state-agnostic default (tier 3); "Construction
-- Debris Disposal" has NO price at all, so it always resolves to "No
-- price available for this ZIP" — a deliberate, documented case, not an
-- oversight.
--
-- Guarded by a single existence check so re-running this migration file
-- by hand is a no-op rather than a duplicate insert.

do $$
declare
  v_paint_interior uuid;
  v_paint_exterior uuid;
  v_primer uuid;
  v_tape uuid;
  v_brush_set uuid;
  v_roller_kit uuid;
  v_drop_cloth uuid;
  v_caulk uuid;
  v_sandpaper uuid;
  v_toilet uuid;
  v_vanity uuid;
  v_bathtub uuid;
  v_shower_fixture uuid;
  v_wall_tile uuid;
  v_grout uuid;
  v_membrane uuid;
  v_exhaust_fan uuid;
  v_vanity_light uuid;
  v_laminate uuid;
  v_hardwood uuid;
  v_vinyl_plank uuid;
  v_underlayment uuid;
  v_baseboard uuid;
  v_flooring_adhesive uuid;
  v_transition_strip uuid;
  v_debris_disposal uuid;
begin
  if exists (select 1 from public.material_catalog_items where scope = 'global') then
    raise notice 'Material catalog demo seed already present -- skipping.';
    return;
  end if;

  -- ===========================================================================
  -- Paint materials (interior_painting / exterior_painting)
  -- ===========================================================================

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Interior Paint', 'Interior latex paint, one coat coverage per label', 'paint', 'interior_painting', 'gallon', 'Demo Supplier')
  returning id into v_paint_interior;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Exterior Paint', 'Weather-resistant exterior acrylic paint', 'paint', 'exterior_painting', 'gallon', 'Demo Supplier')
  returning id into v_paint_exterior;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Primer', 'Stain-blocking interior/exterior primer', 'primer', 'interior_painting', 'gallon', 'Demo Supplier')
  returning id into v_primer;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Painter''s Tape', 'Clean-release masking tape, 1 roll', 'tape', 'interior_painting', 'each', 'Demo Supplier')
  returning id into v_tape;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Paint Brush Set', 'Assorted angled/flat brushes, 3-piece set', 'brushes', 'interior_painting', 'each', 'Demo Supplier')
  returning id into v_brush_set;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Paint Roller Kit', 'Roller frame + 2 covers + tray', 'rollers', 'interior_painting', 'each', 'Demo Supplier')
  returning id into v_roller_kit;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Drop Cloth, Canvas', 'Reusable canvas drop cloth, 9x12 ft', 'drop_cloths', 'interior_painting', 'each', 'Demo Supplier')
  returning id into v_drop_cloth;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Caulk, Tube', 'Paintable acrylic caulk, 10 oz tube', 'other', 'interior_painting', 'each', 'Demo Supplier')
  returning id into v_caulk;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Sandpaper Pack', 'Assorted-grit sandpaper, 10-sheet pack', 'other', 'interior_painting', 'each', 'Demo Supplier')
  returning id into v_sandpaper;

  -- ===========================================================================
  -- Bathroom remodeling materials
  -- ===========================================================================

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Toilet, Standard', 'Standard two-piece toilet, elongated bowl', 'plumbing', 'bathroom_remodeling', 'each', 'Demo Supplier')
  returning id into v_toilet;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Bathroom Vanity, 30in', '30-inch vanity cabinet with top', 'wood', 'bathroom_remodeling', 'each', 'Demo Supplier')
  returning id into v_vanity;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Bathtub, Standard', 'Standard 60-inch alcove bathtub', 'plumbing', 'bathroom_remodeling', 'each', 'Demo Supplier')
  returning id into v_bathtub;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Shower Fixture Set', 'Showerhead, valve, and trim kit', 'plumbing', 'bathroom_remodeling', 'each', 'Demo Supplier')
  returning id into v_shower_fixture;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Ceramic Wall Tile', 'Glazed ceramic wall tile', 'tile', 'bathroom_remodeling', 'sq_ft', 'Demo Supplier')
  returning id into v_wall_tile;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Grout, Bag', 'Sanded grout, 25 lb bag', 'tile', 'bathroom_remodeling', 'each', 'Demo Supplier')
  returning id into v_grout;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Waterproof Membrane, Roll', 'Sheet waterproofing membrane for wet areas', 'other', 'bathroom_remodeling', 'each', 'Demo Supplier')
  returning id into v_membrane;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Bathroom Exhaust Fan', 'Ceiling-mounted exhaust fan, 80 CFM', 'electrical', 'bathroom_remodeling', 'each', 'Demo Supplier')
  returning id into v_exhaust_fan;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Vanity Light Fixture', 'Two-bulb vanity light bar', 'electrical', 'bathroom_remodeling', 'each', 'Demo Supplier')
  returning id into v_vanity_light;

  -- ===========================================================================
  -- Flooring materials
  -- ===========================================================================

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Laminate Flooring', 'Click-lock laminate plank flooring', 'flooring', 'flooring', 'sq_ft', 'Demo Supplier')
  returning id into v_laminate;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Hardwood Flooring', 'Solid hardwood plank flooring', 'flooring', 'flooring', 'sq_ft', 'Demo Supplier')
  returning id into v_hardwood;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Vinyl Plank Flooring', 'Luxury vinyl plank flooring, waterproof', 'flooring', 'flooring', 'sq_ft', 'Demo Supplier')
  returning id into v_vinyl_plank;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Underlayment', 'Foam underlayment for floating floors', 'flooring', 'flooring', 'sq_ft', 'Demo Supplier')
  returning id into v_underlayment;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Baseboard Trim', 'Paint-grade MDF baseboard trim', 'wood', 'flooring', 'linear_ft', 'Demo Supplier')
  returning id into v_baseboard;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Flooring Adhesive', 'Wood flooring adhesive, trowel-grade', 'flooring', 'flooring', 'gallon', 'Demo Supplier')
  returning id into v_flooring_adhesive;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Floor Transition Strip', 'Aluminum transition strip between rooms', 'hardware', 'flooring', 'each', 'Demo Supplier')
  returning id into v_transition_strip;

  insert into public.material_catalog_items (scope, name, description, category, service_type, default_unit, supplier_name)
  values ('global', 'Construction Debris Disposal', 'Haul-away and disposal of flooring/demo debris', 'disposal', 'flooring', 'fixed', 'Demo Supplier')
  returning id into v_debris_disposal;

  -- ===========================================================================
  -- ZIP prices — 4 demo ZIPs (all price_source = 'manual_seed', currency USD)
  -- ===========================================================================

  insert into public.material_zip_prices (material_catalog_item_id, zip_code, state_code, city, unit_price_cents, price_source, supplier_name) values
    (v_paint_interior, '33101', 'FL', 'Miami', 4200, 'manual_seed', 'Demo Supplier'),
    (v_paint_interior, '78701', 'TX', 'Austin', 3800, 'manual_seed', 'Demo Supplier'),
    (v_paint_interior, '90001', 'CA', 'Los Angeles', 4500, 'manual_seed', 'Demo Supplier'),
    (v_paint_interior, '10001', 'NY', 'New York', 4800, 'manual_seed', 'Demo Supplier'),

    (v_paint_exterior, '33101', 'FL', 'Miami', 4600, 'manual_seed', 'Demo Supplier'),
    (v_paint_exterior, '78701', 'TX', 'Austin', 4200, 'manual_seed', 'Demo Supplier'),
    (v_paint_exterior, '90001', 'CA', 'Los Angeles', 4900, 'manual_seed', 'Demo Supplier'),
    (v_paint_exterior, '10001', 'NY', 'New York', 5200, 'manual_seed', 'Demo Supplier'),

    (v_primer, '33101', 'FL', 'Miami', 2800, 'manual_seed', 'Demo Supplier'),
    (v_primer, '78701', 'TX', 'Austin', 2600, 'manual_seed', 'Demo Supplier'),
    (v_primer, '90001', 'CA', 'Los Angeles', 3000, 'manual_seed', 'Demo Supplier'),
    (v_primer, '10001', 'NY', 'New York', 3200, 'manual_seed', 'Demo Supplier'),

    (v_tape, '33101', 'FL', 'Miami', 650, 'manual_seed', 'Demo Supplier'),
    (v_tape, '78701', 'TX', 'Austin', 600, 'manual_seed', 'Demo Supplier'),
    (v_tape, '90001', 'CA', 'Los Angeles', 700, 'manual_seed', 'Demo Supplier'),
    (v_tape, '10001', 'NY', 'New York', 750, 'manual_seed', 'Demo Supplier'),

    (v_brush_set, '33101', 'FL', 'Miami', 1800, 'manual_seed', 'Demo Supplier'),
    (v_brush_set, '78701', 'TX', 'Austin', 1700, 'manual_seed', 'Demo Supplier'),
    (v_brush_set, '90001', 'CA', 'Los Angeles', 1900, 'manual_seed', 'Demo Supplier'),
    (v_brush_set, '10001', 'NY', 'New York', 2100, 'manual_seed', 'Demo Supplier'),

    (v_roller_kit, '33101', 'FL', 'Miami', 1500, 'manual_seed', 'Demo Supplier'),
    (v_roller_kit, '78701', 'TX', 'Austin', 1400, 'manual_seed', 'Demo Supplier'),
    (v_roller_kit, '90001', 'CA', 'Los Angeles', 1600, 'manual_seed', 'Demo Supplier'),
    (v_roller_kit, '10001', 'NY', 'New York', 1750, 'manual_seed', 'Demo Supplier'),

    (v_drop_cloth, '33101', 'FL', 'Miami', 1200, 'manual_seed', 'Demo Supplier'),
    (v_drop_cloth, '78701', 'TX', 'Austin', 1100, 'manual_seed', 'Demo Supplier'),
    (v_drop_cloth, '90001', 'CA', 'Los Angeles', 1300, 'manual_seed', 'Demo Supplier'),
    (v_drop_cloth, '10001', 'NY', 'New York', 1400, 'manual_seed', 'Demo Supplier'),

    (v_caulk, '33101', 'FL', 'Miami', 550, 'manual_seed', 'Demo Supplier'),
    (v_caulk, '78701', 'TX', 'Austin', 500, 'manual_seed', 'Demo Supplier'),
    (v_caulk, '90001', 'CA', 'Los Angeles', 600, 'manual_seed', 'Demo Supplier'),
    (v_caulk, '10001', 'NY', 'New York', 650, 'manual_seed', 'Demo Supplier'),

    (v_toilet, '33101', 'FL', 'Miami', 28000, 'manual_seed', 'Demo Supplier'),
    (v_toilet, '78701', 'TX', 'Austin', 26000, 'manual_seed', 'Demo Supplier'),
    (v_toilet, '90001', 'CA', 'Los Angeles', 32000, 'manual_seed', 'Demo Supplier'),
    (v_toilet, '10001', 'NY', 'New York', 34000, 'manual_seed', 'Demo Supplier'),

    (v_vanity, '33101', 'FL', 'Miami', 42000, 'manual_seed', 'Demo Supplier'),
    (v_vanity, '78701', 'TX', 'Austin', 38000, 'manual_seed', 'Demo Supplier'),
    (v_vanity, '90001', 'CA', 'Los Angeles', 48000, 'manual_seed', 'Demo Supplier'),
    (v_vanity, '10001', 'NY', 'New York', 52000, 'manual_seed', 'Demo Supplier'),

    (v_bathtub, '33101', 'FL', 'Miami', 65000, 'manual_seed', 'Demo Supplier'),
    (v_bathtub, '78701', 'TX', 'Austin', 60000, 'manual_seed', 'Demo Supplier'),
    (v_bathtub, '90001', 'CA', 'Los Angeles', 72000, 'manual_seed', 'Demo Supplier'),
    (v_bathtub, '10001', 'NY', 'New York', 78000, 'manual_seed', 'Demo Supplier'),

    (v_shower_fixture, '33101', 'FL', 'Miami', 32000, 'manual_seed', 'Demo Supplier'),
    (v_shower_fixture, '78701', 'TX', 'Austin', 29000, 'manual_seed', 'Demo Supplier'),
    (v_shower_fixture, '90001', 'CA', 'Los Angeles', 36000, 'manual_seed', 'Demo Supplier'),
    (v_shower_fixture, '10001', 'NY', 'New York', 39000, 'manual_seed', 'Demo Supplier'),

    (v_wall_tile, '33101', 'FL', 'Miami', 650, 'manual_seed', 'Demo Supplier'),
    (v_wall_tile, '78701', 'TX', 'Austin', 600, 'manual_seed', 'Demo Supplier'),
    (v_wall_tile, '90001', 'CA', 'Los Angeles', 750, 'manual_seed', 'Demo Supplier'),
    (v_wall_tile, '10001', 'NY', 'New York', 800, 'manual_seed', 'Demo Supplier'),

    (v_grout, '33101', 'FL', 'Miami', 1800, 'manual_seed', 'Demo Supplier'),
    (v_grout, '78701', 'TX', 'Austin', 1700, 'manual_seed', 'Demo Supplier'),
    (v_grout, '90001', 'CA', 'Los Angeles', 1900, 'manual_seed', 'Demo Supplier'),
    (v_grout, '10001', 'NY', 'New York', 2000, 'manual_seed', 'Demo Supplier'),

    (v_exhaust_fan, '33101', 'FL', 'Miami', 9500, 'manual_seed', 'Demo Supplier'),
    (v_exhaust_fan, '78701', 'TX', 'Austin', 8800, 'manual_seed', 'Demo Supplier'),
    (v_exhaust_fan, '90001', 'CA', 'Los Angeles', 11000, 'manual_seed', 'Demo Supplier'),
    (v_exhaust_fan, '10001', 'NY', 'New York', 12000, 'manual_seed', 'Demo Supplier'),

    (v_vanity_light, '33101', 'FL', 'Miami', 7500, 'manual_seed', 'Demo Supplier'),
    (v_vanity_light, '78701', 'TX', 'Austin', 7000, 'manual_seed', 'Demo Supplier'),
    (v_vanity_light, '90001', 'CA', 'Los Angeles', 8800, 'manual_seed', 'Demo Supplier'),
    (v_vanity_light, '10001', 'NY', 'New York', 9500, 'manual_seed', 'Demo Supplier'),

    (v_laminate, '33101', 'FL', 'Miami', 350, 'manual_seed', 'Demo Supplier'),
    (v_laminate, '78701', 'TX', 'Austin', 320, 'manual_seed', 'Demo Supplier'),
    (v_laminate, '90001', 'CA', 'Los Angeles', 390, 'manual_seed', 'Demo Supplier'),
    (v_laminate, '10001', 'NY', 'New York', 420, 'manual_seed', 'Demo Supplier'),

    (v_hardwood, '33101', 'FL', 'Miami', 850, 'manual_seed', 'Demo Supplier'),
    (v_hardwood, '78701', 'TX', 'Austin', 780, 'manual_seed', 'Demo Supplier'),
    (v_hardwood, '90001', 'CA', 'Los Angeles', 950, 'manual_seed', 'Demo Supplier'),
    (v_hardwood, '10001', 'NY', 'New York', 1050, 'manual_seed', 'Demo Supplier'),

    (v_vinyl_plank, '33101', 'FL', 'Miami', 310, 'manual_seed', 'Demo Supplier'),
    (v_vinyl_plank, '78701', 'TX', 'Austin', 290, 'manual_seed', 'Demo Supplier'),
    (v_vinyl_plank, '90001', 'CA', 'Los Angeles', 340, 'manual_seed', 'Demo Supplier'),
    (v_vinyl_plank, '10001', 'NY', 'New York', 370, 'manual_seed', 'Demo Supplier'),

    (v_underlayment, '33101', 'FL', 'Miami', 80, 'manual_seed', 'Demo Supplier'),
    (v_underlayment, '78701', 'TX', 'Austin', 75, 'manual_seed', 'Demo Supplier'),
    (v_underlayment, '90001', 'CA', 'Los Angeles', 90, 'manual_seed', 'Demo Supplier'),
    (v_underlayment, '10001', 'NY', 'New York', 95, 'manual_seed', 'Demo Supplier'),

    (v_baseboard, '33101', 'FL', 'Miami', 220, 'manual_seed', 'Demo Supplier'),
    (v_baseboard, '78701', 'TX', 'Austin', 200, 'manual_seed', 'Demo Supplier'),
    (v_baseboard, '90001', 'CA', 'Los Angeles', 250, 'manual_seed', 'Demo Supplier'),
    (v_baseboard, '10001', 'NY', 'New York', 270, 'manual_seed', 'Demo Supplier'),

    (v_flooring_adhesive, '33101', 'FL', 'Miami', 3800, 'manual_seed', 'Demo Supplier'),
    (v_flooring_adhesive, '78701', 'TX', 'Austin', 3500, 'manual_seed', 'Demo Supplier'),
    (v_flooring_adhesive, '90001', 'CA', 'Los Angeles', 4200, 'manual_seed', 'Demo Supplier'),
    (v_flooring_adhesive, '10001', 'NY', 'New York', 4500, 'manual_seed', 'Demo Supplier');

  -- Deliberate fallback-tier demo cases (see docs/42-material-catalog-by-zip.md):

  -- Tier 2 (same state): only a state-level price, no zip_code — resolves
  -- for 33101 (FL, inferred from Interior Paint's 33101/FL row above) but
  -- NOT for 78701/90001/10001 (TX/CA/NY).
  insert into public.material_zip_prices (material_catalog_item_id, zip_code, state_code, city, unit_price_cents, price_source, supplier_name)
  values (v_membrane, null, 'FL', null, 8500, 'manual_seed', 'Demo Supplier');

  -- Tier 3 (ZIP/state-agnostic default): resolves for ANY ZIP, including
  -- ones outside the 4 demo ZIPs.
  insert into public.material_zip_prices (material_catalog_item_id, zip_code, state_code, city, unit_price_cents, price_source, supplier_name)
  values
    (v_sandpaper, null, null, null, 900, 'manual_seed', 'Demo Supplier'),
    (v_transition_strip, null, null, null, 1800, 'manual_seed', 'Demo Supplier');

  -- Deliberately NO price row for v_debris_disposal at all -- exercises
  -- "No price available for this ZIP" (find_material_zip_price() never
  -- invents a price).
end $$;
