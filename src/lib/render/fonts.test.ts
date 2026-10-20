import { describe, expect, it } from "vitest";
import { createProject } from "$lib/model/defaults";
import { decodeFontFiles, fontsUsed } from "./fonts";

describe("decodeFontFiles", () => {
  it("splits length-prefixed files", () => {
    const bytes = Uint8Array.from([2, 0, 0, 0, 2, 0, 0, 0, 7, 8, 0, 0, 0, 0]);
    expect(decodeFontFiles(bytes.buffer).map((f) => [...f])).toEqual([[7, 8], []]);
  });
});

describe("fontsUsed", () => {
  it("collects style, override and \\fn tag fonts", () => {
    const p = createProject({ path: "v", width: 1920, height: 1080, fps: 25, duration: 10 });
    p.styles.Sign = { ...p.styles.Default, fontName: "Georgia" };
    p.items = [
      {
        id: "a",
        type: "text",
        start: 0,
        end: 1,
        layer: 0,
        styleName: "Default",
        text: "{\\fnComic Sans MS\\b1}hi {\\i1\\fn@MS Gothic}there {not \\fnreal",
        overrides: { fontName: "ARIAL" },
      },
    ];
    // "ARIAL" duplicates the Default style's "Arial"; "@" (vertical) is dropped.
    expect(fontsUsed(p)).toEqual(["Arial", "Comic Sans MS", "Georgia", "MS Gothic"]);
  });
});
