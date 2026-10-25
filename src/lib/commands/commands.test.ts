import { describe, expect, it } from "vitest";
import { createProject, defaultShapeStyle } from "$lib/model/defaults";
import type { Project, ShapeItem, TextItem } from "$lib/model/project";
import { History, MERGE_WINDOW_MS, inGesture, newGestureKey, type Command } from "./history";
import {
  addItem,
  clampSpan,
  deleteItem,
  duplicateItem,
  editText,
  moveItem,
  setItemLayer,
  setItemSpan,
  setOverride,
  setShapeGeometry,
  setShapeStyle,
  setStyle,
} from "./items";

const FPS = 25;

function project(): Project {
  return createProject({ path: "v.mp4", width: 1280, height: 720, fps: FPS, duration: 60 });
}

function text(id: string, start: number, end: number, body = "hi"): TextItem {
  return { id, type: "text", start, end, layer: 0, text: body, styleName: "Default" };
}

function withItem(): Project {
  return addItem(text("a", 10, 12)).apply(project());
}

const first = (p: Project) => p.items[0] as TextItem;

describe("undo/redo", () => {
  // One case per command type: each must change the project and be undoable.
  const cases: [string, Command, (p: Project) => unknown][] = [
    ["add", addItem(text("b", 1, 2)), (p) => p.items.length],
    ["delete", deleteItem("a"), (p) => p.items.length],
    ["duplicate", duplicateItem("a", "a2"), (p) => p.items.map((i) => [i.start, i.end])],
    ["move", moveItem("a", 20), (p) => first(p).start],
    ["resize", setItemSpan("a", 9, 15), (p) => [first(p).start, first(p).end]],
    ["edit text", editText("a", "changed"), (p) => first(p).text],
    ["set override", setOverride("a", "alignment", 8), (p) => first(p).overrides],
    ["change style", setStyle("Default", { bold: true }), (p) => p.styles.Default.bold],
  ];

  it.each(cases)("undoes and redoes %s", (_, command, observe) => {
    const history = new History();
    const before = withItem();
    const after = history.execute(before, command);
    expect(observe(after)).not.toEqual(observe(before));

    const undone = history.undo(after)!;
    expect(undone).toEqual(before);
    expect(history.redo(undone)).toEqual(after);
  });

  it("records nothing for a command that changes nothing", () => {
    const history = new History();
    const p = withItem();
    expect(history.execute(p, editText("a", "hi"))).toBe(p);
    expect(history.execute(p, deleteItem("missing"))).toBe(p);
    expect(history.canUndo).toBe(false);
  });

  it("clears redo after a new edit", () => {
    const history = new History();
    let p = history.execute(withItem(), editText("a", "one"));
    p = history.undo(p)!;
    history.execute(p, moveItem("a", 30));
    expect(history.canRedo).toBe(false);
  });

  it("merges rapid typing into one step, but not after a pause", () => {
    const history = new History();
    const start = withItem();
    let p = start;
    let t = 0;
    for (const s of ["h", "he", "hel", "hell", "hello"]) {
      p = history.execute(p, editText("a", s), (t += 200));
    }
    p = history.execute(p, editText("a", "hello!"), t + MERGE_WINDOW_MS + 1);

    p = history.undo(p)!;
    expect(first(p).text).toBe("hello");
    p = history.undo(p)!;
    expect(p).toEqual(start);
    expect(history.canUndo).toBe(false);
  });

  it("merges a drag gesture but keeps separate gestures apart", () => {
    const history = new History();
    let p = withItem();
    for (const s of [11, 12, 13]) p = history.execute(p, moveItem("a", s, "drag-1"), 0);
    for (const s of [14, 15]) p = history.execute(p, moveItem("a", s, "drag-2"), 0);
    expect(first(history.undo(p)!).start).toBe(13);
  });

  it("merges a whole gesture even with pauses mid-drag", () => {
    const history = new History();
    const key = newGestureKey();
    let p = withItem();
    p = history.execute(p, inGesture(moveItem("a", 11), key), 0);
    p = history.execute(p, inGesture(moveItem("a", 12), key), 5 * MERGE_WINDOW_MS);
    expect(history.undo(p)).toEqual(withItem());
    expect(history.canUndo).toBe(false);
  });

  it("does not merge typing in different items", () => {
    const history = new History();
    let p = addItem(text("b", 20, 21)).apply(withItem());
    p = history.execute(p, editText("a", "x"), 0);
    p = history.execute(p, editText("b", "y"), 10);
    p = history.undo(p)!;
    expect(first(p).text).toBe("x");
  });
});

describe("timing", () => {
  it("keeps spans inside the video and at least a frame long", () => {
    const p = project();
    expect(clampSpan(p, -5, 2)).toEqual({ start: 0, end: 2 });
    expect(clampSpan(p, 59, 70)).toEqual({ start: 59, end: 60 });
    expect(clampSpan(p, 10, 9)).toEqual({ start: 10, end: 10 + 1 / FPS });
    expect(clampSpan(p, 60, 60)).toEqual({ start: 60 - 1 / FPS, end: 60 });
  });

  it("moves without changing duration, stopping at the ends", () => {
    let p = withItem();
    p = moveItem("a", 59).apply(p);
    expect([first(p).start, first(p).end]).toEqual([58, 60]);
    p = moveItem("a", -3).apply(p);
    expect([first(p).start, first(p).end]).toEqual([0, 2]);
  });

  it("clamps added items", () => {
    const p = addItem(text("b", 58, 65)).apply(project());
    expect([first(p).start, first(p).end]).toEqual([58, 60]);
  });
});

describe("overrides", () => {
  it("removes an override when set to undefined", () => {
    let p = setOverride("a", "bold", true).apply(withItem());
    p = setOverride("a", "bold", undefined).apply(p);
    expect(first(p).overrides).toEqual({});
  });

  it("does not mutate the previous project", () => {
    const before = withItem();
    const frozen = structuredClone(before);
    setOverride("a", "fade", { in: 100, out: 100 }).apply(before);
    setStyle("Default", { fontSize: 99 }).apply(before);
    expect(before).toEqual(frozen);
  });
});

describe("shapes", () => {
  function withShape(): Project {
    const p = { ...project(), shapeStyles: { Box: defaultShapeStyle() } };
    const shape: ShapeItem = {
      id: "s",
      type: "shape",
      start: 1,
      end: 2,
      layer: 0,
      styleName: "Box",
      shape: {
        name: "logo.svg",
        width: 100,
        sourceWidth: 10,
        sourceHeight: 5,
        parts: [{ color: { r: 0, g: 0, b: 0, a: 255 }, path: "m 0 0 l 10 0 10 5" }],
      },
    };
    return addItem(shape).apply(p);
  }
  const shapeOf = (p: Project) => (p.items[0] as ShapeItem).shape;

  it("are undoable", () => {
    for (const command of [
      setShapeGeometry("s", { width: 200 }),
      setShapeStyle("Box", { opacity: 10 }),
      setItemLayer("s", 3),
    ]) {
      const history = new History();
      const before = withShape();
      const after = history.execute(before, command);
      expect(after).not.toEqual(before);
      expect(history.undo(after)).toEqual(before);
    }
  });

  it("skip unchanged values and can replace the picture", () => {
    const p = withShape();
    expect(setShapeGeometry("s", { width: 100 }).apply(p)).toBe(p);
    const parts = [{ color: { r: 9, g: 9, b: 9, a: 255 }, path: "m 0 0 l 4 0 4 4" }];
    const next = { name: "new.svg", sourceWidth: 4, sourceHeight: 4, parts };
    expect(shapeOf(setShapeGeometry("s", next).apply(p))).toEqual({ ...next, width: 100 });
  });

  it("coalesce a run of edits with a merge key", () => {
    const history = new History();
    const before = withShape();
    let p = history.execute(before, setShapeGeometry("s", { width: 110 }, "w"));
    p = history.execute(p, setShapeGeometry("s", { width: 120 }, "w"));
    expect(shapeOf(p)).toMatchObject({ width: 120 });
    expect(history.undo(p)).toEqual(before);
  });

  it("keep layers whole and non-negative", () => {
    const p = withShape();
    expect(setItemLayer("s", -2).apply(p)).toBe(p);
    expect(setItemLayer("s", 2.6).apply(p).items[0].layer).toBe(3);
  });
});
