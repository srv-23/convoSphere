import { describe, expect, it } from "vitest";
import { base64Bytes, fitWithin } from "../src/lib/image.js";

describe("fitWithin", () => {
  it("leaves already small images untouched", () => {
    expect(fitWithin(800, 600, 1280)).toEqual({ width: 800, height: 600 });
  });

  it("scales the longest side down to the limit and keeps the ratio", () => {
    const result = fitWithin(4000, 3000, 1280);

    expect(result.width).toBe(1280);
    expect(result.height).toBe(960);
    expect(result.width / result.height).toBeCloseTo(4000 / 3000, 3);
  });

  it("handles portrait images", () => {
    const result = fitWithin(3000, 4000, 1280);
    expect(result.height).toBe(1280);
    expect(result.width).toBe(960);
  });

  it("never returns a zero dimension for extreme aspect ratios", () => {
    const result = fitWithin(10000, 1, 100);

    expect(result.width).toBe(100);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it("tolerates fractional pixel sizes", () => {
    expect(fitWithin(640.4, 480.6, 1280)).toEqual({ width: 640, height: 481 });
  });
});

describe("base64Bytes", () => {
  it("estimates decoded size", () => {
    expect(base64Bytes(`data:image/jpeg;base64,${"A".repeat(400)}`)).toBe(300);
  });

  it("returns 0 for non data URLs", () => {
    expect(base64Bytes("https://example.com/a.jpg")).toBe(0);
    expect(base64Bytes(null)).toBe(0);
  });
});
