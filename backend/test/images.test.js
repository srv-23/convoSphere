import { describe, expect, it } from "vitest";
import { base64Bytes, isDataImage, validateImagePayload } from "../src/lib/images.js";

// 1x1 transparent PNG
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

describe("image payload validation", () => {
  it("computes decoded size from a base64 data URL", () => {
    // 4 base64 chars == 3 bytes
    const bytes = base64Bytes(`data:image/png;base64,${"A".repeat(400)}`);
    expect(bytes).toBe(300);
  });

  it("accepts a real image data URL", () => {
    expect(isDataImage(PNG_1PX)).toBe(true);
    expect(validateImagePayload(PNG_1PX).ok).toBe(true);
  });

  it("rejects a plain URL or arbitrary string", () => {
    expect(validateImagePayload("https://example.com/a.png").ok).toBe(false);
    expect(validateImagePayload("not-an-image").ok).toBe(false);
  });

  it("rejects a non-image mime type", () => {
    expect(validateImagePayload("data:text/plain;base64,aGVsbG8=").ok).toBe(false);
  });

  it("rejects payloads over the limit before spending an upload", () => {
    const huge = `data:image/jpeg;base64,${"A".repeat(4000)}`;
    const result = validateImagePayload(huge, { maxBytes: 1000 });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/too large/i);
  });

  it("rejects an empty payload", () => {
    expect(validateImagePayload("data:image/png;base64,").ok).toBe(false);
  });
});
