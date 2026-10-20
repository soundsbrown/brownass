import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createProject } from "$lib/model/defaults";
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

  it("adds a style's blur and fade to its events, unless the item overrides them", () => {
    const p = sampleProject();
    p.styles.Default = { ...p.styles.Default, blur: 0.75, fadeIn: 150, fadeOut: 250 };
    const dialogues = serializeAss(p)
      .split("\n")
      .filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues[0]).toBe(
      "Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\\blur0.75\\fad(150,250)}Hello, {\\i1}world{\\i0}!",
    );
    // "A sign" uses the Sign style (no extras) and its own \fad override.
    expect(dialogues[2]).toContain("{\\pos(960,200.5)\\1c&H00C8FF&\\1a&H00&\\fad(200,300)}A sign");
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
