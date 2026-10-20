import { describe, expect, it } from "vitest";
import { createProject } from "./defaults";
import type { Project, TextItem } from "./project";
import {
  captionsWithoutStyle,
  conformToStylesheet,
  firstStyle,
  houseStyle,
  parseStylesheet,
  serializeStylesheet,
} from "./stylesheet";

const sheet = houseStyle("house");

function project(styleNames: string[]): Project {
  const p = createProject({ path: "v", width: 1920, height: 1080, fps: 25, duration: 60 });
  p.items = styleNames.map((styleName, n) => ({
    id: String(n),
    type: "text",
    start: n,
    end: n + 0.5,
    layer: 0,
    text: "x",
    styleName,
  }));
  return p;
}

describe("stylesheet file", () => {
  it("round-trips", () => {
    expect(parseStylesheet(serializeStylesheet(sheet))).toEqual(sheet);
  });

  it("rejects ids that aren't safe file names", () => {
    expect(() => parseStylesheet(JSON.stringify({ ...sheet, id: "../x" }))).toThrow(/id/);
  });

  it("needs at least one style", () => {
    expect(() => parseStylesheet(JSON.stringify({ ...sheet, styles: {} }))).toThrow(/one style/);
  });
});

describe("conformToStylesheet", () => {
  it("gives the project exactly the stylesheet's styles", () => {
    const { project: p } = conformToStylesheet(project([]), sheet);
    expect(p.stylesheet).toBe("house");
    expect(Object.keys(p.styles)).toEqual(["Subtitle", "Section title"]);
    // "Default" from createProject is gone.
    expect(p.styles).toEqual(sheet.styles);
  });

  it("keeps captions' styles the stylesheet has, and reassigns the rest", () => {
    const before = project(["Section title", "Default", "Imported sign"]);
    expect(captionsWithoutStyle(before, sheet)).toBe(2);
    const { project: p, reassigned } = conformToStylesheet(before, sheet);
    expect(reassigned).toBe(2);
    expect(p.items.map((i) => (i as TextItem).styleName)).toEqual([
      "Section title",
      firstStyle(sheet),
      firstStyle(sheet),
    ]);
  });
});
