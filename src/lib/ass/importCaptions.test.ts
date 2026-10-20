import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { VideoRef } from "$lib/model/project";
import { importCaptions } from "./importCaptions";

const fixture = (name: string) =>
  readFileSync(new URL(`../../../tests/fixtures/${name}`, import.meta.url), "utf8");
const video: VideoRef = { path: "x.mp4", width: 1920, height: 1080, fps: 25, duration: 600 };

describe("importCaptions", () => {
  it("keeps timing, layer and text, drops styles and formatting", () => {
    const { items, notes } = importCaptions(fixture("aegisub-sample.ass"), video, "Subtitle");
    expect(
      items.map(({ start, end, layer, text, styleName }) => [start, end, layer, text, styleName]),
    ).toEqual([
      [1, 3, 0, "First line\nsecond line", "Subtitle"],
      [3.5, 5, 1, "A sign, with commas, in the text", "Subtitle"],
      [6, 7, 0, "Unknown style falls back", "Subtitle"],
      [9, 10, 0, "  leading spaces are kept", "Subtitle"],
    ]);
    expect(items.every((i) => i.overrides === undefined)).toBe(true);
    expect(notes).toEqual([
      "1 comment line not kept.",
      "1 event with invalid times or fields skipped.",
      "Formatting tags removed from 1 caption.",
      `The file's styles aren't used; every caption uses "Subtitle".`,
    ]);
  });

  it("skips drawings and captions left empty", () => {
    const ass = [
      "[Events]",
      "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100{\\p0}",
      "Dialogue: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,{\\an8}",
      "Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,kept",
    ].join("\n");
    const { items, notes } = importCaptions(ass, video, "Subtitle");
    expect(items.map((i) => i.text)).toEqual(["kept"]);
    expect(notes).toContain("1 drawing skipped.");
  });
});
