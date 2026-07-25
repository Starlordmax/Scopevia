import { describe, expect, it } from "vitest";
import { validateLogoFile, buildLogoStoragePath, extensionForLogoMimeType, MAX_LOGO_SIZE_BYTES } from "../../src/lib/branding/logo-validation";

describe("validateLogoFile (Phase 3D.2)", () => {
  it("accepts PNG", () => {
    expect(validateLogoFile({ type: "image/png", size: 1024 })).toEqual({ ok: true });
  });

  it("accepts JPEG", () => {
    expect(validateLogoFile({ type: "image/jpeg", size: 1024 })).toEqual({ ok: true });
  });

  it("accepts WEBP", () => {
    expect(validateLogoFile({ type: "image/webp", size: 1024 })).toEqual({ ok: true });
  });

  it("rejects SVG (blocked for MVP to avoid script/content injection)", () => {
    const result = validateLogoFile({ type: "image/svg+xml", size: 1024 });
    expect(result.ok).toBe(false);
  });

  it("rejects an unrelated file type", () => {
    const result = validateLogoFile({ type: "application/pdf", size: 1024 });
    expect(result.ok).toBe(false);
  });

  it("rejects a file over 10 MB with a friendly message naming the real limit", () => {
    const result = validateLogoFile({ type: "image/png", size: MAX_LOGO_SIZE_BYTES + 1 });
    expect(result).toEqual({ ok: false, error: "Please upload a PNG, JPG, or WEBP image under 10 MB." });
  });

  it("accepts a file exactly at the 10 MB limit", () => {
    expect(validateLogoFile({ type: "image/png", size: MAX_LOGO_SIZE_BYTES }).ok).toBe(true);
  });

  it("rejects an empty file", () => {
    const result = validateLogoFile({ type: "image/png", size: 0 });
    expect(result.ok).toBe(false);
  });

  it("rejects a negative size", () => {
    const result = validateLogoFile({ type: "image/png", size: -1 });
    expect(result.ok).toBe(false);
  });
});

describe("extensionForLogoMimeType (Phase 3D.2)", () => {
  it("maps each allowed MIME type to its expected extension", () => {
    expect(extensionForLogoMimeType("image/png")).toBe("png");
    expect(extensionForLogoMimeType("image/jpeg")).toBe("jpg");
    expect(extensionForLogoMimeType("image/webp")).toBe("webp");
  });

  it("falls back to png for an unrecognized type rather than throwing", () => {
    expect(extensionForLogoMimeType("image/svg+xml")).toBe("png");
  });
});

describe("buildLogoStoragePath (Phase 3D.2)", () => {
  it("always starts with the tenant id as the first path segment", () => {
    const path = buildLogoStoragePath("tenant-a", "image/png", "uuid-1");
    expect(path.startsWith("tenant-a/")).toBe(true);
  });

  it("never lets one tenant's path resolve under a different tenant's folder", () => {
    const pathA = buildLogoStoragePath("tenant-a", "image/png", "uuid-1");
    const pathB = buildLogoStoragePath("tenant-b", "image/png", "uuid-1");
    expect(pathA.split("/")[0]).toBe("tenant-a");
    expect(pathB.split("/")[0]).toBe("tenant-b");
    expect(pathA).not.toBe(pathB);
  });

  it("embeds the unique id and correct extension in the filename", () => {
    expect(buildLogoStoragePath("tenant-a", "image/jpeg", "abc-123")).toBe("tenant-a/logo-abc-123.jpg");
  });
});
