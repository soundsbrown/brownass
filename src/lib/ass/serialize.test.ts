import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createProject, defaultShapeStyle } from "$lib/model/defaults";
import type { Project } from "$lib/model/project";
import { escapeText, overrideBlock, serializeAss } from "./serialize";

const fixture = (name: string) =>
  readFileSync(new URL(`../../../tests/fixtures/${name}`, import.meta.url), "utf8");

function sampleProject(): Project {
  const p = createProject({
    path: "C:\\videos\\sample.mp4",
    width: 1920,
    height: 1080,
    fps: 30000 / 1001,
    duration: 120,
  });
  p.styles["Sign"] = { ...p.styles["Default"], fontName: "Georgia", alignment: 8, bold: true };
  p.items = [
    {
      id: "b",
      type: "text",
      start: 5.005,
      end: 8.341,
      layer: 0,
      text: "Second line,\nwith a break",
      styleName: "Default",
    },
    {
      id: "a",
      type: "text",
      start: 1.0010009,
      end: 3.5,
      layer: 0,
      text: "Hello, {\\i1}world{\\i0}!",
      styleName: "Default",
    },
    {
      id: "c",
      type: "text",
      start: 5.005,
      end: 6,
      layer: 1,
      text: "A sign",
      styleName: "Sign",
      overrides: {
        pos: { x: 960, y: 200.5 },
        primaryColor: { r: 255, g: 200, b: 0, a: 255 },
        fade: { in: 200, out: 300 },
        marginV: 30,
      },
    },
  ];
  return p;
}

describe("serializeAss", () => {
  it("matches the golden file", () => {
    expect(serializeAss(sampleProject())).toBe(fixture("serialize-sample.ass"));
  });

  it("writes events in time order regardless of item order", () => {
    const events = serializeAss(sampleProject())
      .split("\n")
      .filter((l) => l.startsWith("Dialogue:"));
    expect(events.map((l) => l.split(",")[1])).toEqual(["0:00:01.00", "0:00:05.00", "0:00:05.00"]);
  });
});

describe("style scaling and style-level tags", () => {
  it("writes styles in the script's pixels", () => {
    const p = sampleProject();
    p.playRes = { x: 3840, y: 2160 };
    const line = serializeAss(p)
      .split("\n")
      .find((l) => l.startsWith("Style: Default,"));
    // Font 59 -> 118, outline 3 -> 6, margins 58/58/43 -> 116/116/86.
    expect(line).toBe(
      "Style: Default,Arial,118,&H00FFFFFF,&H000000FF,&H00000000,&H7F000000,0,0,0,0,100,100,0,0,1,6,0,2,116,116,86,1",
    );
  });

  it("adds a style's fade to its events, unless the item overrides it", () => {
    const p = sampleProject();
    p.styles.Default = { ...p.styles.Default, fadeIn: 150, fadeOut: 250 };
    const dialogues = serializeAss(p)
      .split("\n")
      .filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues[0]).toBe(
      String.raw`Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\fad(150,250)}Hello, {\i1}world{\i0}!`,
    );
    // "A sign" uses the Sign style (no extras) and its own \fad override.
    expect(dialogues[2]).toContain(
      String.raw`{\pos(960,200.5)\1c&H00C8FF&\1a&H00&\fad(200,300)}A sign`,
    );
  });

  it("draws shadows as separate events under their captions, blurring only them", () => {
    const p = sampleProject();
    p.styles.Default = { ...p.styles.Default, shadow: 2, blur: 0.75 };
    const dialogues = serializeAss(p)
      .split("\n")
      .filter((l) => l.startsWith("Dialogue:"));
    // Layer 0 becomes 1, with its shadow on 0; the sign's layer 1 becomes 3.
    expect(dialogues.slice(0, 2)).toEqual([
      String.raw`Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\1a&HFE&\3a&HFE&\shad2\blur0.75}Hello, {\i1}world{\i0}!`,
      String.raw`Dialogue: 1,0:00:01.00,0:00:03.50,Default,,0,0,0,,Hello, {\i1}world{\i0}!`,
    ]);
    // The Sign style has no shadow: no shadow event.
    expect(dialogues.filter((l) => l.includes("A sign"))).toEqual([
      expect.stringMatching(/^Dialogue: 3,/),
    ]);
  });

  it("casts no shadow with a transparent shadow colour, blurred or not", () => {
    const p = sampleProject();
    const clear = { r: 0, g: 0, b: 0, a: 0 };
    p.styles.Default = { ...p.styles.Default, shadow: 2, blur: 1, backColor: clear };
    expect(serializeAss(p)).not.toContain("\\shad");
    p.styles.Default = { ...p.styles.Default, shadow: 0, blur: 1 };
    expect(serializeAss(p)).not.toContain("\\blur");
  });
});

describe("escapeText", () => {
  it("turns every kind of line break into \\N", () => {
    expect(escapeText("a\nb\r\nc\rd")).toBe("a\\Nb\\Nc\\Nd");
  });

  it("keeps override blocks and braces verbatim", () => {
    expect(escapeText("{\\b1}bold{\\b0} {not a tag}")).toBe("{\\b1}bold{\\b0} {not a tag}");
  });
});

describe("overrideBlock", () => {
  it("is empty without overrides", () => {
    expect(overrideBlock({})).toBe("");
  });

  it("writes margins as fields, not tags", () => {
    expect(overrideBlock({ marginL: 10, marginV: 20 })).toBe("");
  });

  it("writes boolean and numeric tags", () => {
    expect(overrideBlock({ bold: false, italic: true, outline: 2.5, blur: 0.75 })).toBe(
      "{\\b0\\i1\\bord2.5\\blur0.75}",
    );
  });
});

describe("shapes", () => {
  /** A 720p project (factor 2/3) with a bar and a multi-colour logo. */
  function shapesProject(): Project {
    const p = createProject({
      path: "shapes.mp4",
      width: 1280,
      height: 720,
      fps: 25,
      duration: 60,
    });
    p.shapeStyles = {
      Bar: { ...defaultShapeStyle(), opacity: 50, alignment: 2, marginV: 90 },
      Logo: {
        ...defaultShapeStyle(),
        outline: 3,
        blur: 1.5,
        fadeIn: 200,
        fadeOut: 400,
        alignment: 9,
        marginR: 30,
        marginV: 30,
      },
    };
    const base = { start: 1, end: 4, layer: 0 } as const;
    const red = { r: 255, g: 0, b: 0, a: 255 };
    p.items = [
      {
        ...base,
        id: "bar",
        type: "shape",
        styleName: "Bar",
        shape: {
          name: "bar.svg",
          width: 300,
          sourceWidth: 30,
          sourceHeight: 6,
          parts: [{ color: { r: 0, g: 0, b: 0, a: 255 }, path: "m 0 0 l 30 0 30 6 0 6" }],
        },
      },
      {
        ...base,
        id: "logo",
        type: "shape",
        layer: 2,
        styleName: "Logo",
        shape: {
          name: "logo.svg",
          width: 120,
          sourceWidth: 40,
          sourceHeight: 20,
          parts: [
            { color: red, path: "m 0 0 l 10 0 10 10 0 10" },
            { color: red, path: "m 20 0 l 30 0 30 10" },
            { color: { r: 0, g: 0, b: 255, a: 128 }, path: "m 30 10 l 40 20 30 20" },
          ],
        },
      },
    ];
    return p;
  }

  function dialogues(p: Project): string[] {
    return serializeAss(p)
      .split("\n")
      .filter((l) => l.startsWith("Dialogue:"));
  }

  it("matches the golden file", () => {
    expect(serializeAss(shapesProject())).toBe(fixture("serialize-shapes.ass"));
  });

  it("places shapes by their style's alignment and margins, in script pixels", () => {
    // 300×60 reference px -> 200×40; bottom centre, 90 -> 60 above the bottom.
    expect(dialogues(shapesProject())[0]).toBe(
      String.raw`Dialogue: 0,0:00:01.00,0:00:04.00,Bar,,0,0,0,,{\an7\pos(540,620)\1c&H000000&\1a&H7F&\bord0\p3}m 0 0 l 800 0 800 160 0 160`,
    );
  });

  it("keeps an SVG's parts in place and merges same-colour neighbours", () => {
    const logo = dialogues(shapesProject()).filter(
      (l) => l.startsWith("Dialogue: 2,") && !l.includes("&HFE&"),
    );
    expect(logo).toHaveLength(2);
    // 120 reference px wide -> 80 script px, so 2 px per SVG unit. Top right
    // with 30 -> 20 px margins: the box spans x 1180..1260, y 20..60.
    expect(logo[0]).toContain(
      String.raw`{\an7\pos(1180,20)\1c&H0000FF&\1a&H00&\bord0\fad(200,400)\p3}`,
    );
    // The blue triangle starts at SVG (30, 10): 60, 20 px into the box.
    expect(logo[1]).toContain(String.raw`\pos(1240,40)\1c&HFF0000&\1a&H7F&`);
  });

  it("gives the whole shape one shadow and one outline, under all its parts", () => {
    const p = shapesProject();
    p.shapeStyles.Logo.shadow = 6;
    const logo = dialogues(p).filter((l) => l.includes(",Logo,"));
    // Layer 2 becomes 5, with the shadow on 4.
    expect(logo.map((l) => l.split(",")[0])).toEqual([
      "Dialogue: 4",
      "Dialogue: 5",
      "Dialogue: 5",
      "Dialogue: 5",
    ]);
    // Shadow (6 -> 4 px, blurred) and outline are of all parts together.
    const silhouette = "m 0 0 l 80 0 80 80 0 80 m 160 0 l 240 0 240 80 m 240 80 l 320 160 240 160";
    expect(logo[0]).toBe(
      String.raw`Dialogue: 4,0:00:01.00,0:00:04.00,Logo,,0,0,0,,{\an7\pos(1180,20)\fad(200,400)\1a&HFE&\3a&HFE&\shad4\blur1\p3}` +
        silhouette,
    );
    expect(logo[1]).toBe(
      String.raw`Dialogue: 5,0:00:01.00,0:00:04.00,Logo,,0,0,0,,{\an7\pos(1180,20)\fad(200,400)\1a&HFE&\p3}` +
        silhouette,
    );
    // The parts have no outline, shadow or blur of their own.
    for (const part of logo.slice(2)) {
      expect(part).toContain(String.raw`\bord0`);
      expect(part).not.toMatch(/\\shad|\\blur/);
    }
  });

  it("leaves out invisible parts, which would otherwise cast shadows", () => {
    const p = shapesProject();
    const logo = p.items[1];
    if (logo.type !== "shape") throw new Error("not a shape");
    const clear = { r: 0, g: 0, b: 0, a: 0 };
    logo.shape.parts.unshift({ color: clear, path: "m -50 -50 l 90 -50 90 70 -50 70" });
    expect(serializeAss(p)).toBe(serializeAss(shapesProject()));
  });

  it("applies the style's opacity to SVG colours", () => {
    const p = shapesProject();
    p.shapeStyles.Logo.opacity = 50;
    const logo = dialogues(p).filter((l) => l.startsWith("Dialogue: 2,") && !l.includes("&HFE&"));
    expect(logo[0]).toContain(String.raw`\1a&H7F&`);
    expect(logo[1]).toContain(String.raw`\1a&HBF&`);
  });
});
