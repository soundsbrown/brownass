import { describe, expect, it } from "vitest";
import { createProject, defaultStyle } from "$lib/model/defaults";
import type { Project, TextItem } from "$lib/model/project";
import { houseStyle } from "$lib/model/stylesheet";
import { History } from "./history";
import { addStyle, deleteStyle, linkStylesheet, renameStyle, setItemStyle } from "./styles";

const sheet = houseStyle("house");

function project(): Project {
  const p = createProject({ path: "v", width: 1920, height: 1080, fps: 25, duration: 60 });
  p.styles = { ...sheet.styles };
  p.stylesheet = sheet.id;
  p.items = [
    { id: "a", type: "text", start: 1, end: 2, layer: 0, text: "a", styleName: "Subtitle" },
    { id: "b", type: "text", start: 3, end: 4, layer: 0, text: "b", styleName: "Section title" },
  ];
  return p;
}

const styleOf = (p: Project, id: string) =>
  (p.items.find((i) => i.id === id) as TextItem).styleName;

describe("style commands", () => {
  it("are undoable", () => {
    for (const command of [
      addStyle("New", defaultStyle()),
      deleteStyle("Section title"),
      renameStyle("Subtitle", "Dialogue"),
      setItemStyle("a", "Section title"),
    ]) {
      const history = new History();
      const before = project();
      const after = history.execute(before, command);
      expect(after).not.toEqual(before);
      expect(history.undo(after)).toEqual(before);
    }
  });

  it("renames in place and in every caption", () => {
    const p = renameStyle("Subtitle", "Dialogue").apply(project());
    expect(Object.keys(p.styles)).toEqual(["Dialogue", "Section title"]);
    expect(styleOf(p, "a")).toBe("Dialogue");
  });

  it("refuses names that are taken or invalid", () => {
    const p = project();
    expect(renameStyle("Subtitle", "Section title").apply(p)).toBe(p);
    expect(renameStyle("Subtitle", "a,b").apply(p)).toBe(p);
    expect(renameStyle("Subtitle", "  ").apply(p)).toBe(p);
    expect(addStyle("Subtitle", defaultStyle()).apply(p)).toBe(p);
  });

  it("moves captions off a deleted style, and keeps the last style", () => {
    let p = deleteStyle("Section title").apply(project());
    expect(styleOf(p, "b")).toBe("Subtitle");
    const before = p;
    p = deleteStyle("Subtitle").apply(p);
    expect(p).toBe(before);
  });

  it("only assigns existing styles", () => {
    const p = project();
    expect(setItemStyle("a", "Nope").apply(p)).toBe(p);
  });
});

describe("linkStylesheet", () => {
  const other = {
    ...houseStyle("other"),
    styles: { Caption: { ...defaultStyle(), fontName: "Georgia" } },
  };

  it("takes the new stylesheet's styles, dropping unused ones from the old", () => {
    const p = linkStylesheet(other, sheet).apply(project());
    expect(p.stylesheet).toBe("other");
    // Both old styles are still used by captions, so they stay.
    expect(Object.keys(p.styles)).toEqual(["Caption", "Subtitle", "Section title"]);

    const unused = { ...project(), items: [] };
    expect(Object.keys(linkStylesheet(other, sheet).apply(unused).styles)).toEqual(["Caption"]);
  });

  it("keeps project-only styles", () => {
    const p = project();
    p.styles.Imported = defaultStyle();
    expect(Object.keys(linkStylesheet(other, sheet).apply({ ...p, items: [] }).styles)).toEqual([
      "Caption",
      "Imported",
    ]);
  });
});
