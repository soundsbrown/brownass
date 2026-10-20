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
