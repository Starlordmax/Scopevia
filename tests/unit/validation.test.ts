import { describe, expect, it } from "vitest";
import {
  slugSchema,
  slugify,
  tenantNameSchema,
  passwordSchema,
  emailSchema,
  roleKeySchema,
  membershipStatusSchema,
} from "../../src/lib/validation/schemas";

describe("slugSchema", () => {
  it("accepts a well-formed slug", () => {
    expect(slugSchema.safeParse("mikes-painting").success).toBe(true);
  });

  it("lowercases input", () => {
    const result = slugSchema.safeParse("Mikes-Painting");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("mikes-painting");
  });

  it("rejects spaces", () => {
    expect(slugSchema.safeParse("mikes painting").success).toBe(false);
  });

  it("rejects consecutive/leading/trailing hyphens shape violations", () => {
    expect(slugSchema.safeParse("-mikes-painting").success).toBe(false);
    expect(slugSchema.safeParse("mikes-painting-").success).toBe(false);
  });

  it("rejects a too-short slug", () => {
    expect(slugSchema.safeParse("a").success).toBe(false);
  });
});

describe("slugify", () => {
  it("converts a business name into a URL-safe slug", () => {
    expect(slugify("Mike's Painting & Co.")).toBe("mike-s-painting-co");
  });

  it("trims leading/trailing separators", () => {
    expect(slugify("  --Hello World--  ")).toBe("hello-world");
  });

  it("truncates to 60 characters", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(60);
  });
});

describe("tenantNameSchema", () => {
  it("rejects a name shorter than 2 characters", () => {
    expect(tenantNameSchema.safeParse("A").success).toBe(false);
  });

  it("accepts a normal business name", () => {
    expect(tenantNameSchema.safeParse("Mike's Painting").success).toBe(true);
  });
});

describe("passwordSchema", () => {
  it("rejects a password shorter than 8 characters", () => {
    expect(passwordSchema.safeParse("short1").success).toBe(false);
  });

  it("accepts an 8+ character password", () => {
    expect(passwordSchema.safeParse("longenough1").success).toBe(true);
  });
});

describe("emailSchema", () => {
  it("normalizes case", () => {
    const result = emailSchema.safeParse("Mike@Example.com");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("mike@example.com");
  });

  it("rejects a malformed address", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  });
});

describe("roleKeySchema", () => {
  it("excludes 'owner' — cannot be granted via invite/update in Phase 0", () => {
    expect(roleKeySchema.safeParse("owner").success).toBe(false);
  });

  it("accepts the five grantable roles", () => {
    for (const role of ["admin", "estimator", "sales", "field_worker", "viewer"]) {
      expect(roleKeySchema.safeParse(role).success).toBe(true);
    }
  });
});

describe("membershipStatusSchema", () => {
  it("excludes 'invited' — not a client-settable target status in Phase 0", () => {
    expect(membershipStatusSchema.safeParse("invited").success).toBe(false);
  });

  it("accepts active/suspended/removed", () => {
    for (const status of ["active", "suspended", "removed"]) {
      expect(membershipStatusSchema.safeParse(status).success).toBe(true);
    }
  });
});
