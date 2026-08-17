import { describe, expect, it } from "vitest";
import {
  createClientSchema,
  createClientContactSchema,
  dollarsToCentsSchema,
  createOpportunitySchema,
  changeOpportunityStatusSchema,
  createProjectSchema,
  createProjectAddressSchema,
  postalCodeSchema,
  createNoteSchema,
} from "../../src/lib/validation/crm";
import { OPPORTUNITY_TRANSITIONS, opportunityStatusLabel } from "../../src/lib/crm/opportunity-transitions";
import { PROJECT_TRANSITIONS, projectStatusLabel } from "../../src/lib/crm/project-transitions";
import { OPPORTUNITY_STATUSES, PROJECT_STATUSES } from "../../types/enums";

describe("createClientSchema", () => {
  it("requires a non-empty display name", () => {
    expect(createClientSchema.safeParse({ clientType: "individual", displayName: "" }).success).toBe(false);
  });

  it("accepts a minimal individual client", () => {
    const result = createClientSchema.safeParse({ clientType: "individual", displayName: "Sarah Nguyen" });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed email but tolerates an empty one", () => {
    expect(createClientSchema.safeParse({ clientType: "individual", displayName: "A", email: "not-an-email" }).success).toBe(false);
    expect(createClientSchema.safeParse({ clientType: "individual", displayName: "A", email: "" }).success).toBe(true);
  });

  it("rejects an invalid client type", () => {
    expect(createClientSchema.safeParse({ clientType: "corporation", displayName: "A" }).success).toBe(false);
  });
});

describe("createClientContactSchema", () => {
  it("requires a first name and a valid parent client id", () => {
    expect(
      createClientContactSchema.safeParse({ clientId: "not-a-uuid", firstName: "Jane" }).success
    ).toBe(false);
    expect(
      createClientContactSchema.safeParse({ clientId: "00000000-0000-0000-0000-000000000000", firstName: "" }).success
    ).toBe(false);
  });
});

describe("dollarsToCentsSchema", () => {
  it("converts a plain dollar amount to integer cents", () => {
    const result = dollarsToCentsSchema.safeParse("12.50");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(1250);
  });

  it("strips thousands separators and currency symbols", () => {
    const result = dollarsToCentsSchema.safeParse("$1,234.00");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(123400);
  });

  it("treats an empty value as absent, not an error", () => {
    const result = dollarsToCentsSchema.safeParse("");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeUndefined();
  });

  it("rejects non-numeric input", () => {
    expect(dollarsToCentsSchema.safeParse("free").success).toBe(false);
  });

  it("rejects more than two decimal places", () => {
    expect(dollarsToCentsSchema.safeParse("1.005").success).toBe(false);
  });
});

describe("createOpportunitySchema", () => {
  const base = { clientId: "00000000-0000-0000-0000-000000000000", title: "New roof" };

  it("accepts a minimal opportunity", () => {
    expect(createOpportunitySchema.safeParse(base).success).toBe(true);
  });

  it("rejects a blank title", () => {
    expect(createOpportunitySchema.safeParse({ ...base, title: "   " }).success).toBe(false);
  });

  it("rejects a probability outside 0-100", () => {
    expect(createOpportunitySchema.safeParse({ ...base, probability: 150 }).success).toBe(false);
    expect(createOpportunitySchema.safeParse({ ...base, probability: -1 }).success).toBe(false);
  });
});

describe("changeOpportunityStatusSchema", () => {
  it("accepts every declared opportunity status as a syntactically valid target, given its required companion field", () => {
    for (const status of OPPORTUNITY_STATUSES) {
      const extra =
        status === "lost"
          ? { lostReason: "Client went with another contractor" }
          : status === "inspection_scheduled"
            ? { inspectionScheduledAt: "2026-01-01T10:00" }
            : {};
      expect(changeOpportunityStatusSchema.safeParse({ newStatus: status, ...extra }).success).toBe(true);
    }
  });

  it("rejects an unknown status", () => {
    expect(changeOpportunityStatusSchema.safeParse({ newStatus: "made_up" }).success).toBe(false);
  });

  it("requires a lost reason when moving to lost", () => {
    const result = changeOpportunityStatusSchema.safeParse({ newStatus: "lost" });
    expect(result.success).toBe(false);
  });

  it("requires an inspection date when moving to inspection_scheduled", () => {
    const result = changeOpportunityStatusSchema.safeParse({ newStatus: "inspection_scheduled" });
    expect(result.success).toBe(false);
  });
});

describe("createProjectSchema", () => {
  it("requires a non-empty name", () => {
    expect(
      createProjectSchema.safeParse({ clientId: "00000000-0000-0000-0000-000000000000", name: "" }).success
    ).toBe(false);
  });
});

describe("createProjectAddressSchema", () => {
  const base = {
    projectId: "00000000-0000-0000-0000-000000000000",
    addressLine1: "123 Main St",
    city: "Springfield",
    state: "IL",
    postalCode: "62704",
  };

  it("accepts a well-formed US address and defaults the country code", () => {
    const result = createProjectAddressSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.countryCode).toBe("US");
  });

  it("requires address line 1, city, and state", () => {
    expect(createProjectAddressSchema.safeParse({ ...base, addressLine1: "" }).success).toBe(false);
    expect(createProjectAddressSchema.safeParse({ ...base, city: "" }).success).toBe(false);
    expect(createProjectAddressSchema.safeParse({ ...base, state: "" }).success).toBe(false);
  });
});

describe("postalCodeSchema", () => {
  it("accepts a US ZIP and a Canadian postal code", () => {
    expect(postalCodeSchema.safeParse("62704").success).toBe(true);
    expect(postalCodeSchema.safeParse("K1A 0B1").success).toBe(true);
  });

  it("rejects an empty postal code", () => {
    expect(postalCodeSchema.safeParse("").success).toBe(false);
  });
});

describe("createNoteSchema", () => {
  const uuid = "00000000-0000-0000-0000-000000000000";

  it("accepts a note with exactly one parent", () => {
    expect(createNoteSchema.safeParse({ body: "Called the client", clientId: uuid }).success).toBe(true);
  });

  it("rejects a note with zero parents", () => {
    expect(createNoteSchema.safeParse({ body: "Orphan note" }).success).toBe(false);
  });

  it("rejects a note with more than one parent", () => {
    expect(
      createNoteSchema.safeParse({ body: "Ambiguous parent", clientId: uuid, opportunityId: uuid }).success
    ).toBe(false);
  });

  it("rejects an empty body", () => {
    expect(createNoteSchema.safeParse({ body: "", clientId: uuid }).success).toBe(false);
  });
});

// =============================================================================
// State machine transition maps — these are UI-only mirrors of the SQL state
// machines (see docs/22-phase-1-state-machines.md); the tests here guard
// against the two ways they can silently drift from the database: a status
// missing an entry entirely, or a target status that isn't a valid status.
// =============================================================================

describe("OPPORTUNITY_TRANSITIONS", () => {
  it("has an entry for every opportunity status", () => {
    for (const status of OPPORTUNITY_STATUSES) {
      expect(OPPORTUNITY_TRANSITIONS[status]).toBeDefined();
    }
  });

  it("every listed target is itself a valid opportunity status", () => {
    for (const targets of Object.values(OPPORTUNITY_TRANSITIONS)) {
      for (const target of targets) {
        expect(OPPORTUNITY_STATUSES).toContain(target);
      }
    }
  });

  it("terminal states (won, archived) have no outgoing transitions", () => {
    expect(OPPORTUNITY_TRANSITIONS.won).toEqual([]);
    expect(OPPORTUNITY_TRANSITIONS.archived).toEqual([]);
  });

  it("archived is not directly reachable from any other status (only via archive_opportunity)", () => {
    for (const [status, targets] of Object.entries(OPPORTUNITY_TRANSITIONS)) {
      if (status === "archived") continue;
      expect(targets).not.toContain("archived");
    }
  });
});

describe("opportunityStatusLabel", () => {
  it("replaces underscores with spaces", () => {
    expect(opportunityStatusLabel("inspection_scheduled")).toBe("inspection scheduled");
  });
});

describe("PROJECT_TRANSITIONS", () => {
  it("has an entry for every project status", () => {
    for (const status of PROJECT_STATUSES) {
      expect(PROJECT_TRANSITIONS[status]).toBeDefined();
    }
  });

  it("every listed target is itself a valid project status", () => {
    for (const targets of Object.values(PROJECT_TRANSITIONS)) {
      for (const target of targets) {
        expect(PROJECT_STATUSES).toContain(target);
      }
    }
  });

  it("archived has no outgoing transitions", () => {
    expect(PROJECT_TRANSITIONS.archived).toEqual([]);
  });

  it("archived is not directly reachable from any other status (only via archive_project)", () => {
    for (const [status, targets] of Object.entries(PROJECT_TRANSITIONS)) {
      if (status === "archived") continue;
      expect(targets).not.toContain("archived");
    }
  });
});

describe("projectStatusLabel", () => {
  it("replaces underscores with spaces", () => {
    expect(projectStatusLabel("ready_for_estimate")).toBe("ready for estimate");
  });
});
