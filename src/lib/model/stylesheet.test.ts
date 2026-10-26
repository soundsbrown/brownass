import { describe, expect, it } from "vitest";
import { createProject, defaultShapeStyle } from "./defaults";
import type { Item, Overlay, Project, TextItem } from "./project";
import {
  conformToStylesheet,
  describeReassigned,
  firstShapeStyle,
  firstStyle,
  houseStyle,
  itemsWithoutStyle,
  parseStylesheet,
  serializeStylesheet,
} from "./stylesheet";

const sheet = houseStyle("house");

const logo: Overlay = {
  id: "logo",
  styleName: "Shape",
  shape: {
    name: "logo.svg",
    width: 100,
    sourceWidth: 10,
    sourceHeight: 10,
    parts: [{ color: { r: 255, g: 0, b: 0, a: 255 }, path: "m 0 0 l 10 0 10 10" }],
  },
};

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
    expect(() => parseStylesheet(JSON.stringify({ ...sheet, shapeStyles: {} }))).toThrow(
      /one shape style/,
    );
  });

  it("keeps shape and text style names apart", () => {
    const clash = { ...sheet, shapeStyles: { Subtitle: defaultShapeStyle() } };
    expect(() => parseStylesheet(JSON.stringify(clash))).toThrow(/different names/);
  });

  it("upgrades v1 files with a shape style of an unused name", () => {
    const v1 = {
      version: 1,
      id: "old",
      name: "Old",
      styles: { Shape: sheet.styles.Subtitle },
    };
    const upgraded = parseStylesheet(JSON.stringify(v1));
    expect(upgraded.version).toBe(3);
    expect(upgraded.styles).toEqual(v1.styles);
    expect(upgraded.shapeStyles).toEqual({ "Shape 2": defaultShapeStyle() });
    expect(upgraded.overlays).toEqual([]);
  });

  it("upgrades v2 files without overlays", () => {
    const { overlays, ...v2 } = { ...sheet, version: 2 };
    expect(overlays).toEqual([]);
    expect(parseStylesheet(JSON.stringify(v2))).toEqual(sheet);
  });

  it("needs overlays to use one of its shape styles", () => {
    const bad = { ...sheet, overlays: [{ ...logo, styleName: "Subtitle" }] };
    expect(() => parseStylesheet(JSON.stringify(bad))).toThrow(/overlay/);
  });
});

describe("conformToStylesheet", () => {
  it("gives the project exactly the stylesheet's styles", () => {
    const { project: p } = conformToStylesheet(project([]), sheet);
    expect(p.stylesheet).toBe("house");
    expect(Object.keys(p.styles)).toEqual(["Subtitle", "Section title"]);
    // "Default" from createProject is gone.
    expect(p.styles).toEqual(sheet.styles);
    expect(p.shapeStyles).toEqual(sheet.shapeStyles);
  });

  it("gives the project the stylesheet's overlays", () => {
    const withLogo = { ...sheet, overlays: [logo] };
    expect(conformToStylesheet(project([]), withLogo).project.overlays).toEqual([logo]);
    const old = { ...project([]), overlays: [logo] };
    expect(conformToStylesheet(old, sheet).project.overlays).toEqual([]);
  });

  it("keeps captions' styles the stylesheet has, and reassigns the rest", () => {
    const before = project(["Section title", "Default", "Imported sign"]);
    expect(itemsWithoutStyle(before, sheet)).toEqual({ captions: 2, shapes: 0 });
    const { project: p, reassigned } = conformToStylesheet(before, sheet);
    expect(reassigned).toEqual({ captions: 2, shapes: 0 });
    expect(p.items.map((i) => (i as TextItem).styleName)).toEqual([
      "Section title",
      firstStyle(sheet),
      firstStyle(sheet),
    ]);
  });
});

describe("shapes", () => {
  function withShapes(styleNames: string[]): Project {
    const p = project(["Subtitle"]);
    const shapes: Item[] = styleNames.map((styleName, n) => ({
      id: `s${n}`,
      type: "shape",
      start: n,
      end: n + 1,
      layer: 1,
      styleName,
      shape: { name: "x.svg", width: 10, sourceWidth: 1, sourceHeight: 1, parts: [] },
    }));
    return { ...p, items: [...p.items, ...shapes] };
  }

  it("reassigns shapes whose style the stylesheet lacks", () => {
    const before = withShapes(["Shape", "Gone"]);
    const { project: p, reassigned } = conformToStylesheet(before, sheet);
    expect(reassigned).toEqual({ captions: 0, shapes: 1 });
    expect(p.items.filter((i) => i.type === "shape").map((i) => i.styleName)).toEqual([
      "Shape",
      firstShapeStyle(sheet),
    ]);
  });

  it("describes what gets reassigned", () => {
    expect(describeReassigned({ captions: 2, shapes: 1 }, sheet, "will")).toBe(
      '2 captions will switch to "Subtitle" and 1 shape will switch to "Shape"',
    );
    expect(describeReassigned({ captions: 1, shapes: 0 }, sheet, "now")).toBe(
      '1 caption now uses "Subtitle"',
    );
  });
});
