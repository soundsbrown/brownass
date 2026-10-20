import { describe, expect, it } from "vitest";
import type { Color } from "$lib/model/project";
import { parseColor, styleColor, tagAlpha, tagColor } from "./color";

const orange: Color = { r: 0xff, g: 0x80, b: 0x10, a: 0xff };

describe("ASS colours", () => {
  it("writes BGR order with inverted alpha", () => {
    expect(styleColor(orange)).toBe("&H001080FF");
    expect(styleColor({ r: 0, g: 0, b: 0, a: 128 })).toBe("&H7F000000");
    expect(tagColor(orange)).toBe("&H1080FF&");
    expect(tagAlpha({ ...orange, a: 0 })).toBe("&HFF&");
  });

  it("round-trips every alpha and channel value", () => {
    for (let n = 0; n < 256; n++) {
      const c: Color = { r: n, g: 255 - n, b: (n * 7) % 256, a: (n * 13) % 256 };
      expect(parseColor(styleColor(c))).toEqual(c);
    }
  });

  it("parses tag colours and short forms as opaque", () => {
    expect(parseColor("&H1080FF&")).toEqual(orange);
    expect(parseColor("&HFF&")).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it("parses decimal colours from old files", () => {
    expect(parseColor("16777215")).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });

  it("rejects garbage", () => {
    expect(parseColor("white")).toBeNull();
    expect(parseColor("&HXYZ")).toBeNull();
  });
});
