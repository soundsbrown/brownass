import { describe, expect, it } from "vitest";
import { fromHex, fromPercent, toHex, toPercent } from "./color";

describe("colour fields", () => {
  it("converts to and from #rrggbb, keeping opacity", () => {
    expect(toHex({ r: 255, g: 128, b: 0, a: 10 })).toBe("#ff8000");
    expect(fromHex("#FF8000", 10)).toEqual({ r: 255, g: 128, b: 0, a: 10 });
    expect(fromHex("red", 255)).toBeNull();
  });

  it("maps opacity to percent and back", () => {
    expect(toPercent(255)).toBe(100);
    expect(toPercent(128)).toBe(50);
    expect(fromPercent(50)).toBe(128);
    expect(fromPercent(150)).toBe(255);
    for (let p = 0; p <= 100; p++) expect(toPercent(fromPercent(p))).toBe(p);
  });
});
