import { describe, expect, it } from "vitest";
import { createProject } from "./defaults";
import { ProjectFileError, parseProjectFile, serializeProjectFile } from "./file";
import { PROJECT_VERSION, type Project } from "./project";

function sample(): Project {
  const p = createProject({
    path: "D:\\Vidéos\\clip with spaces.mp4",
    width: 1920,
    height: 1080,
    fps: 24000 / 1001,
    duration: 1234.5678,
  });
  p.items = [
    {
      id: "6f1c",
      type: "text",
      start: 1.0010010010010009,
      end: 2.5,
      layer: 2,
      text: "Ünïcode, {\\i1}tags{\\i0}\nand lines",
      styleName: "Default",
      overrides: { pos: { x: 10.25, y: 20 }, fade: { in: 0, out: 150 }, alignment: 7 },
    },
  ];
  return p;
}

describe("migrations", () => {
  it("upgrades v1: styles to reference pixels, with blur and fade", () => {
    const v1 = {
      version: 1,
      video: { path: "v.mp4", width: 1280, height: 720, fps: 25, duration: 10 },
      playRes: { x: 1280, y: 720 },
      styles: {
        Default: {
          ...createProject({ path: "", width: 1, height: 1, fps: 1, duration: 1 }).styles.Default,
          fontSize: 40,
          outline: 2,
          marginV: 30,
          blur: undefined,
          fadeIn: undefined,
          fadeOut: undefined,
        },
      },
      items: [
        { id: "a", type: "text", start: 0, end: 1, layer: 0, text: "x", styleName: "Default" },
      ],
    };
    const p = parseProjectFile(JSON.stringify(v1));
    expect(p.version).toBe(PROJECT_VERSION);
    expect(p.styles.Default).toMatchObject({
      fontSize: 60,
      outline: 3,
      marginV: 45,
      blur: 0,
      fadeIn: 0,
      fadeOut: 0,
    });
    expect(p.items).toHaveLength(1);
  });
});

describe("project file", () => {
  it("round-trips losslessly", () => {
    const p = sample();
    expect(parseProjectFile(serializeProjectFile(p))).toEqual(p);
  });

  it("rejects files from a newer version", () => {
    const json = JSON.stringify({ ...sample(), version: PROJECT_VERSION + 1 });
    expect(() => parseProjectFile(json)).toThrow(/newer version/);
  });

  it("rejects non-JSON and unversioned files", () => {
    expect(() => parseProjectFile("{nope")).toThrow(ProjectFileError);
    expect(() => parseProjectFile("{}")).toThrow(/no version/);
  });

  it("reports where validation failed", () => {
    const p = sample();
    const bad = { ...p, items: [{ ...p.items[0], layer: -1 }] };
    expect(() => parseProjectFile(JSON.stringify(bad))).toThrow(/items\.0\.layer/);
  });

  it("enforces cross-field rules", () => {
    const p = sample();
    const backwards = { ...p, items: [{ ...p.items[0], start: 5, end: 4 }] };
    expect(() => parseProjectFile(JSON.stringify(backwards))).toThrow(/end after it starts/);
    const missingStyle = { ...p, items: [{ ...p.items[0], styleName: "Nope" }] };
    expect(() => parseProjectFile(JSON.stringify(missingStyle))).toThrow(/existing style/);
  });

  it("rejects style names that would break ASS lines", () => {
    const p = sample();
    const bad = { ...p, styles: { "A,B": p.styles.Default } };
    expect(() => parseProjectFile(JSON.stringify(bad))).toThrow(/commas/);
  });
});
