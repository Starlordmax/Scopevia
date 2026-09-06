import { describe, expect, it } from "vitest";
import { acceptanceRecordFootnote, imageUnavailableLabel } from "../../src/lib/proposals/export-copy";

describe("acceptanceRecordFootnote (Phase 3C export document)", () => {
  it("never claims to be a legal e-signature or promises legal validity", () => {
    const text = acceptanceRecordFootnote();
    expect(text).not.toMatch(/e-signature|electronic signature|legally binding|certifies/i);
  });

  it("describes what the approval records, in plain language", () => {
    const text = acceptanceRecordFootnote();
    expect(text).toMatch(/reviewed and accepted/i);
  });
});

describe("imageUnavailableLabel (Phase 3C export document)", () => {
  it("is a friendly, non-technical fallback", () => {
    const text = imageUnavailableLabel();
    expect(text).toBe("Image unavailable");
    expect(text).not.toMatch(/error|failed|404|null|undefined/i);
  });
});
