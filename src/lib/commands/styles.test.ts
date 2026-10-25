import { describe, expect, it } from "vitest";
import { createProject, defaultShapeStyle, defaultStyle } from "$lib/model/defaults";
import type { Project } from "$lib/model/project";
import { houseStyle } from "$lib/model/stylesheet";
import { History } from "./history";
import { addStyle, deleteStyle, linkStylesheet, renameStyle, setItemStyle } from "./styles";

const sheet = houseStyle("house");

function project(): Project {
  const p = createProject({ path: "v", width: 1920, height: 1080, fps: 25, duration: 60 });
  p.styles = { ...sheet.styles };
  p.shapeStyles = { Box: defaultShapeStyle(), Dot: { ...defaultShapeStyle(), opacity: 50 } };
  p.stylesheet = sheet.id;
  p.items = [
    { id: "a", type: "text", start: 1, end: 2, layer: 0, text: "a", styleName: "Subtitle" },
    { id: "b", type: "text", start: 3, end: 4, layer: 0, text: "b", styleName: "Section title" },
    {
      id: "s",
      type: "shape",
      start: 1,
      end: 2,
      layer: 1,
      styleName: "Box",
      shape: { name: "x.svg", width: 10, sourceWidth: 1, sourceHeight: 1, parts: [] },
    },
  ];
  return p;
}

const styleOf = (p: Project, id: string) => p.items.find((i) => i.id === id)!.styleName;

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

describe("shape style commands", () => {
  it("are undoable", () => {
    for (const command of [
      addStyle("Bar", defaultShapeStyle(), "shape"),
      deleteStyle("Box", undefined, "shape"),
      renameStyle("Box", "Panel", "shape"),
      setItemStyle("s", "Dot"),
    ]) {
      const history = new History();
      const before = project();
      const after = history.execute(before, command);
      expect(after).not.toEqual(before);
      expect(history.undo(after)).toEqual(before);
    }
  });

  it("rename and delete shape styles only for shapes", () => {
    let p = renameStyle("Box", "Panel", "shape").apply(project());
    expect(Object.keys(p.shapeStyles)).toEqual(["Panel", "Dot"]);
    expect(styleOf(p, "s")).toBe("Panel");
    p = deleteStyle("Panel", undefined, "shape").apply(p);
    expect(styleOf(p, "s")).toBe("Dot");
    expect(Object.keys(p.styles)).toEqual(["Subtitle", "Section title"]);
  });

  it("keep names unique across text and shape styles", () => {
    const p = project();
    expect(renameStyle("Box", "Subtitle", "shape").apply(p)).toBe(p);
    expect(renameStyle("Subtitle", "Box").apply(p)).toBe(p);
    expect(addStyle("Subtitle", defaultShapeStyle(), "shape").apply(p)).toBe(p);
    expect(addStyle("Dot", defaultStyle()).apply(p)).toBe(p);
  });

  it("assigns styles of the item's own kind", () => {
    const p = project();
    expect(setItemStyle("s", "Subtitle").apply(p)).toBe(p);
    expect(setItemStyle("a", "Dot").apply(p)).toBe(p);
  });
});

describe("linkStylesheet", () => {
  const other = {
    ...houseStyle("other"),
    styles: {
      Caption: { ...defaultStyle(), fontName: "Georgia" },
      "Section title": { ...defaultStyle(), fontSize: 120 },
    },
  };

  it("takes exactly the new stylesheet's styles", () => {
    const p = linkStylesheet(other).apply(project());
    expect(p.stylesheet).toBe("other");
    expect(Object.keys(p.styles)).toEqual(["Caption", "Section title"]);
    expect(p.styles["Section title"].fontSize).toBe(120);
  });

  it("keeps same-named styles and moves the rest to the first style", () => {
    const p = linkStylesheet(other).apply(project());
    expect(styleOf(p, "a")).toBe("Caption"); // was Subtitle
    expect(styleOf(p, "b")).toBe("Section title");
  });

  it("is a single undoable step", () => {
    const history = new History();
    const before = project();
    const after = history.execute(before, linkStylesheet(other));
    expect(history.undo(after)).toEqual(before);
  });
});
