import { describe, expect, it } from "vitest";
import { defaultStyle } from "./defaults";
import {
  applyStylesheet,
  houseStyle,
  mirrorStyles,
  parseStylesheet,
  serializeStylesheet,
  type Styles,
} from "./stylesheet";

const sheet = houseStyle("house");
const imported = { ...defaultStyle(), fontName: "Comic Sans MS" };

describe("stylesheet file", () => {
  it("round-trips", () => {
    expect(parseStylesheet(serializeStylesheet(sheet))).toEqual(sheet);
  });

  it("rejects ids that aren't safe file names", () => {
    expect(() => parseStylesheet(JSON.stringify({ ...sheet, id: "../x" }))).toThrow(/id/);
  });
});

describe("applyStylesheet", () => {
  it("takes the stylesheet's styles and keeps the project's own", () => {
    const stale = { ...sheet.styles.Subtitle, fontSize: 1 };
    const styles = applyStylesheet({ Subtitle: stale, Imported: imported }, sheet);
    expect(Object.keys(styles)).toEqual(["Subtitle", "Section title", "Imported"]);
    expect(styles.Subtitle).toBe(sheet.styles.Subtitle);
    expect(styles.Imported).toBe(imported);
  });
});

describe("mirrorStyles", () => {
  const linked: Styles = applyStylesheet({ Imported: imported }, sheet);

  it("returns the same sheet when nothing changed", () => {
    expect(mirrorStyles(sheet, linked, linked)).toBe(sheet);
    expect(mirrorStyles(sheet, linked, { ...linked })).toBe(sheet);
  });

  it("copies edits to stylesheet styles", () => {
    const edited = { ...linked, Subtitle: { ...linked.Subtitle, bold: true } };
    expect(mirrorStyles(sheet, linked, edited).styles.Subtitle.bold).toBe(true);
  });

  it("keeps project-only styles out, even when edited", () => {
    const edited = { ...linked, Imported: { ...imported, bold: true } };
    expect(mirrorStyles(sheet, linked, edited)).toBe(sheet);
  });

  it("adds new styles and removes deleted ones", () => {
    const { ["Section title"]: removed, ...rest } = linked;
    void removed;
    const after = { ...rest, Caption: defaultStyle() };
    const mirrored = mirrorStyles(sheet, linked, after);
    expect(Object.keys(mirrored.styles).sort()).toEqual(["Caption", "Subtitle"]);
  });

  it("treats a rename as removing the old name and adding the new", () => {
    const after = Object.fromEntries(
      Object.entries(linked).map(([n, s]) => [n === "Subtitle" ? "Dialogue" : n, s]),
    );
    const mirrored = mirrorStyles(sheet, linked, after);
    expect(Object.keys(mirrored.styles)).toEqual(["Dialogue", "Section title"]);
  });

  it("keeps stylesheet styles the project never had", () => {
    const partial = { Subtitle: sheet.styles.Subtitle };
    const after = { Subtitle: { ...sheet.styles.Subtitle, italic: true } };
    const mirrored = mirrorStyles(sheet, partial, after);
    expect(Object.keys(mirrored.styles)).toEqual(["Subtitle", "Section title"]);
    expect(mirrored.styles.Subtitle.italic).toBe(true);
  });
});
