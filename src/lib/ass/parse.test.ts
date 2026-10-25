import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TextItem, VideoRef } from "$lib/model/project";
import { parseProjectFile, serializeProjectFile } from "$lib/model/file";
import { parseAss } from "./parse";
import { serializeAss } from "./serialize";

const fixture = (name: string) =>
  readFileSync(new URL(`../../../tests/fixtures/${name}`, import.meta.url), "utf8");

const video: VideoRef = { path: "x.mp4", width: 1920, height: 1080, fps: 25, duration: 600 };
const texts = (items: unknown[]) => (items as TextItem[]).map((i) => i.text);

describe("parseAss", () => {
  it("round-trips the serializer's own output exactly", () => {
    const golden = fixture("serialize-sample.ass");
    const { project, warnings } = parseAss(golden, video);
    expect(warnings).toEqual([]);
    expect(serializeAss(project)).toBe(golden);
  });

  it("writes a lower-resolution file's styles back exactly", () => {
    const original = fixture("aegisub-sample.ass");
    const styleLines = (text: string) => text.split("\n").filter((l) => l.startsWith("Style:"));
    // Except for the shadow, which is written as separate events.
    const noShadow = (line: string) =>
      line
        .split(",")
        .map((f, i) => (i === 17 ? "0" : f))
        .join(",");
    const { project } = parseAss(original, video);
    expect(styleLines(serializeAss(project))).toEqual(styleLines(original).map(noShadow));
  });

  it("produces a valid project", () => {
    const { project } = parseAss(fixture("aegisub-sample.ass"), video);
    expect(() => parseProjectFile(serializeProjectFile(project))).not.toThrow();
  });

  it("reads an Aegisub file with its quirks", () => {
    const { project, warnings } = parseAss(fixture("aegisub-sample.ass"), video);
    expect(project.playRes).toEqual({ x: 1280, y: 720 });
    expect(Object.keys(project.styles)).toEqual(["Default", "Sign"]);
    expect(project.styles.Sign).toMatchObject({
      fontName: "Trebuchet MS",
      // 42.5 px in a 720-line script is 63.75 reference (1080-line) pixels.
      fontSize: 63.75,
      marginV: 15,
      bold: true,
      alignment: 8,
      primaryColor: { r: 0x22, g: 0x88, b: 0xff, a: 255 },
      // &H80...: 0x80 transparency, i.e. opacity 127.
      backColor: { r: 0, g: 0, b: 0, a: 127 },
    });

    expect(texts(project.items)).toEqual([
      "First line\nsecond line",
      "{\\pos(640,80)\\fad(100,200)}A sign, with commas, in the text",
      "Unknown style falls back",
      "  leading spaces are kept",
    ]);
    const sign = project.items[1] as TextItem;
    expect(sign).toMatchObject({ start: 3.5, end: 5, layer: 1, styleName: "Sign" });
    expect(sign.overrides).toEqual({ marginV: 15 });
    expect((project.items[2] as TextItem).styleName).toBe("Default");

    expect(warnings).toEqual([
      "The file was made for 1280×720, the video is 1920×1080. Positions keep the file's coordinates.",
      'Unknown style "Missing" replaced by "Default".',
      "1 comment line not kept.",
      "1 event with invalid times or fields skipped.",
      "Not kept: [aegisub project garbage], [fonts] sections.",
    ]);
  });

  it("converts legacy SSA alignment and decimal colours", () => {
    const ssa = [
      "[Script Info]",
      "ScriptType: v4.00",
      "PlayResY: 480",
      "[V4 Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding",
      "Style: Default,Arial,20,16777215,65535,0,0,-1,0,1,2,0,6,10,10,10,0,0",
      "[Events]",
      "Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: Marked=0,0:00:01.00,0:00:02.00,*Default,,0000,0000,0000,,Top centre",
    ].join("\n");
    const { project } = parseAss(ssa, video);
    expect(project.playRes).toEqual({ x: 640, y: 480 });
    expect(project.styles.Default).toMatchObject({
      alignment: 8,
      bold: true,
      primaryColor: { r: 255, g: 255, b: 255, a: 255 },
    });
    expect(project.items[0]).toMatchObject({ layer: 0, styleName: "Default", text: "Top centre" });
  });

  it("uses a default style and libass's default resolution for bare files", () => {
    const { project } = parseAss(
      "[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,Hi",
      video,
    );
    expect(project.playRes).toEqual({ x: 384, y: 288 });
    expect(Object.keys(project.styles)).toEqual(["Default"]);
    expect(project.items).toHaveLength(1);
  });

  it("handles a byte order mark and CRLF line endings", () => {
    const text = "﻿[Script Info]\r\nPlayResX: 1920\r\nPlayResY: 1080\r\n";
    expect(parseAss(text, video).project.playRes).toEqual({ x: 1920, y: 1080 });
  });
});
