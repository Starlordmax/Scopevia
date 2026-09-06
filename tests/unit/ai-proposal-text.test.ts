import { afterEach, describe, expect, it, vi } from "vitest";
import { aiProposalTextDraftSchema, generateProposalTextRequestSchema } from "../../src/lib/validation/ai-proposal-text";
import { buildProposalTextPrompt } from "../../src/lib/ai/prompt";
import { buildFallbackProposalTextDraft } from "../../src/lib/ai/fallback-templates";
import { generateProposalTextDraft } from "../../src/lib/ai/openrouter";
import { PERMISSIONS } from "../../src/lib/auth/permission-keys";
import type { Database } from "../../types/database";
import type { ProposalContextSummary } from "../../src/lib/ai/proposal-context";

type BusinessProfile = Database["public"]["Tables"]["business_profiles"]["Row"];

function fakeBusinessProfile(overrides: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    tenant_id: "00000000-0000-0000-0000-000000000000",
    business_name: "Mike's Painting",
    industry: "Residential painting",
    main_services: "Interior and exterior painting",
    service_area: "Miami-Dade",
    business_address: "",
    business_phone: "",
    business_email: "",
    license_number: "",
    insurance_statement: "",
    default_warranty_policy: "",
    default_payment_terms: "",
    default_deposit_policy: "",
    default_change_order_policy: "",
    default_cancellation_policy: "",
    default_cleanup_policy: "",
    default_materials_policy: "",
    default_client_responsibilities: "",
    default_exclusions: "",
    tone_preference: "professional",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function fakeProposalContext(overrides: Partial<ProposalContextSummary> = {}): ProposalContextSummary {
  return {
    proposalTitle: "Exterior repaint",
    serviceType: "exterior_painting",
    customServiceName: null,
    clientDisplayName: "Jane Doe",
    scopeSummary: null,
    scopeIntro: null,
    sectionTitles: ["Surface preparation", "Painting work"],
    measurementCount: 1,
    measurementNames: ["Front elevation"],
    laborItemCount: 1,
    laborLabels: ["Painting crew"],
    materialLineItemCount: 2,
    materialCategories: ["material", "equipment"],
    currentJobPhotoCount: 0,
    ...overrides,
  };
}

describe("generateProposalTextRequestSchema", () => {
  const base = {
    proposalId: "11111111-1111-4111-8111-111111111111",
    proposalVersionId: "22222222-2222-4222-8222-222222222222",
    feature: "all" as const,
  };

  it("defaults length to standard and every include flag to true", () => {
    const result = generateProposalTextRequestSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.length).toBe("standard");
    expect(result.data.includeWarranty).toBe(true);
  });

  it("rejects an unknown feature", () => {
    expect(generateProposalTextRequestSchema.safeParse({ ...base, feature: "made_up" }).success).toBe(false);
  });
});

describe("aiProposalTextDraftSchema", () => {
  it("accepts a well-formed draft", () => {
    const result = aiProposalTextDraftSchema.safeParse({ terms: "Terms text", exclusions: "", clientNotes: "", warnings: [] });
    expect(result.success).toBe(true);
  });

  it("defaults every field when the model omits keys, rather than failing", () => {
    const result = aiProposalTextDraftSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ terms: "", exclusions: "", clientNotes: "", warnings: [] });
  });

  it("rejects a completely malformed shape (e.g. a plain string, not an object)", () => {
    expect(aiProposalTextDraftSchema.safeParse("not json").success).toBe(false);
    expect(aiProposalTextDraftSchema.safeParse(null).success).toBe(false);
  });
});

describe("buildProposalTextPrompt", () => {
  const request = generateProposalTextRequestSchema.parse({
    proposalId: "11111111-1111-4111-8111-111111111111",
    proposalVersionId: "22222222-2222-4222-8222-222222222222",
    feature: "all",
  });

  it("never includes anything resembling an API key or secret", () => {
    const { system, user } = buildProposalTextPrompt(request, fakeBusinessProfile(), fakeProposalContext());
    const combined = `${system}\n${user}`;
    expect(combined).not.toMatch(/sk-|api[_-]?key|OPENROUTER/i);
  });

  it("weaves in business profile fields that are present", () => {
    const profile = fakeBusinessProfile({ default_warranty_policy: "One year workmanship warranty." });
    const { user } = buildProposalTextPrompt(request, profile, fakeProposalContext());
    expect(user).toContain("Mike's Painting");
    expect(user).toContain("One year workmanship warranty.");
  });

  it("tells the model to use neutral language for a policy that was left blank", () => {
    const { user } = buildProposalTextPrompt(request, fakeBusinessProfile({ default_warranty_policy: "" }), fakeProposalContext());
    expect(user).toMatch(/Warranty policy:.*not provided/i);
  });

  it("scopes the instruction to only the requested feature", () => {
    const termsOnly = generateProposalTextRequestSchema.parse({ ...request, feature: "terms" });
    const { system } = buildProposalTextPrompt(termsOnly, fakeBusinessProfile(), fakeProposalContext());
    expect(system).toMatch(/Draft only "terms"/);
  });

  it("includes the proposal's client name and scope sections, never the client's phone/email/address", () => {
    const { user } = buildProposalTextPrompt(request, fakeBusinessProfile(), fakeProposalContext());
    expect(user).toContain("Jane Doe");
    expect(user).toContain("Surface preparation");
    // Data minimization: the prompt builder is never given phone/email/
    // address in the first place (ProposalContextSummary has no such
    // fields) -- this assertion documents that guarantee at the type
    // level as much as the string level.
    expect(user).not.toMatch(/@|\d{3}-\d{3}-\d{4}/);
  });
});

describe("buildFallbackProposalTextDraft", () => {
  it("produces non-empty terms/exclusions/clientNotes without any API call", () => {
    const draft = buildFallbackProposalTextDraft(fakeBusinessProfile(), fakeProposalContext());
    expect(draft.terms.length).toBeGreaterThan(0);
    expect(draft.exclusions.length).toBeGreaterThan(0);
    expect(draft.clientNotes.length).toBeGreaterThan(0);
  });

  it("flags itself as a basic template, not an AI draft, via warnings", () => {
    const draft = buildFallbackProposalTextDraft(fakeBusinessProfile(), fakeProposalContext());
    expect(draft.warnings.some((w) => /basic template/i.test(w))).toBe(true);
  });

  it("uses the business name in the client-facing note and a provided warranty policy verbatim in terms", () => {
    const profile = fakeBusinessProfile({ default_warranty_policy: "Workmanship warranty for 1 year." });
    const draft = buildFallbackProposalTextDraft(profile, fakeProposalContext());
    expect(draft.clientNotes).toContain("Mike's Painting");
    expect(draft.terms).toContain("Workmanship warranty for 1 year.");
  });

  it("still produces generic, non-empty terms when every policy field is blank", () => {
    const draft = buildFallbackProposalTextDraft(fakeBusinessProfile(), fakeProposalContext());
    expect(draft.terms).toMatch(/scope/i);
  });
});

describe("generateProposalTextDraft (OpenRouter module)", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("returns a friendly 'missing_api_key' error and makes NO network call when OPENROUTER_API_KEY is unset", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await generateProposalTextDraft("system prompt", "user prompt");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("missing_api_key");
    expect(result.message).toBe("AI writing is not configured yet.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a friendly 'invalid_json' error (after one retry) when the model's response isn't valid JSON, never crashing", async () => {
    process.env.OPENROUTER_API_KEY = "test-key-not-real";
    let callCount = 0;
    global.fetch = vi.fn(async () => {
      callCount += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: "not json at all" } }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await generateProposalTextDraft("system prompt", "user prompt");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("invalid_json");
    // Retried exactly once, not in an unbounded loop.
    expect(callCount).toBe(2);
  });

  it("parses a well-formed JSON response, including token usage", async () => {
    process.env.OPENROUTER_API_KEY = "test-key-not-real";
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ terms: "Terms.", exclusions: "", clientNotes: "", warnings: [] }) } }],
          usage: { prompt_tokens: 120, completion_tokens: 45 },
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    const result = await generateProposalTextDraft("system prompt", "user prompt");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.terms).toBe("Terms.");
    expect(result.inputTokens).toBe(120);
    expect(result.outputTokens).toBe(45);
  });

  it("strips ```json code fences before parsing", async () => {
    process.env.OPENROUTER_API_KEY = "test-key-not-real";
    const fenced = "```json\n" + JSON.stringify({ terms: "Fenced terms.", exclusions: "", clientNotes: "", warnings: [] }) + "\n```";
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: fenced } }] }), { status: 200 })) as unknown as typeof fetch;

    const result = await generateProposalTextDraft("system prompt", "user prompt");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.terms).toBe("Fenced terms.");
  });

  it("returns a friendly 'request_failed' error, never the raw provider error body, on a non-2xx response", async () => {
    process.env.OPENROUTER_API_KEY = "test-key-not-real";
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: "some internal provider detail" } }), { status: 500 })) as unknown as typeof fetch;

    const result = await generateProposalTextDraft("system prompt", "user prompt");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("request_failed");
    expect(result.message).not.toContain("internal provider detail");
  });
});

describe("AI permission key", () => {
  it("registers ai.generate_proposal_text in the shared PERMISSIONS map", () => {
    expect(PERMISSIONS.AI_GENERATE_PROPOSAL_TEXT).toBe("ai.generate_proposal_text");
  });
});
