import { describe, expect, it } from "vitest";
import { defaultStyle } from "./defaults";
import { scaleStyle, styleScale, unscaleStyle } from "./scale";

describe("styleScale", () => {
  it("scales by the shorter side relative to 1080 lines", () => {
    expect(styleScale({ x: 1920, y: 1080 })).toBe(1);
    expect(styleScale({ x: 3840, y: 2160 })).toBe(2);
    expect(styleScale({ x: 1280, y: 720 })).toBeCloseTo(2 / 3);
    // Vertical video: 1080 wide, so the same as landscape 1080p.
    expect(styleScale({ x: 1080, y: 1920 })).toBe(1);
  });
});

describe("scaleStyle", () => {
  it("scales sizes and rounds margins, leaving the rest alone", () => {
    const s = { ...defaultStyle(), blur: 1.5, spacing: 2, shadow: 2 };
    const scaled = scaleStyle(s, 2);
    expect(scaled).toMatchObject({
      fontSize: 118,
      outline: 6,
      shadow: 4,
      blur: 3,
      spacing: 4,
      marginL: 116,
      marginV: 86,
      fontName: "Arial",
      alignment: 2,
      scaleX: 100,
      fadeIn: 0,
    });
    expect(scaleStyle(s, 2 / 3).marginV).toBe(29);
  });

  it("round-trips whole-pixel values through reference units", () => {
    const factor = 2 / 3;
    for (let margin = 0; margin < 200; margin++) {
      const style = { ...defaultStyle(), marginL: margin };
      expect(scaleStyle(unscaleStyle(style, factor), factor).marginL).toBe(margin);
    }
  });
});
