import { describe, expect, it } from "vitest";
import { styleColor } from "./styleColors";

describe("styleColor", () => {
  const names = ["Subtitle", "Section title", "Speaker 2"];

  it("gives each style its own colour, by position", () => {
    const colors = names.map((n) => styleColor(names, n).fill);
    expect(new Set(colors).size).toBe(3);
    expect(styleColor(names, "Subtitle").fill).toBe("#355f91");
  });

  it("keeps a style's colour when it's renamed", () => {
    const renamed = ["Subtitle", "Title", "Speaker 2"];
    expect(styleColor(renamed, "Title")).toEqual(styleColor(names, "Section title"));
  });

  it("repeats the palette for many styles, and greys out unknown ones", () => {
    const many = Array.from({ length: 10 }, (_, i) => `S${i}`);
    expect(styleColor(many, "S8")).toEqual(styleColor(many, "S0"));
    expect(styleColor(names, "Missing").fill).toBe("#555a63");
  });
});
