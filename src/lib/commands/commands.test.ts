import { describe, expect, it } from "vitest";
import { createProject } from "$lib/model/defaults";
import type { Project, TextItem } from "$lib/model/project";
import { History, MERGE_WINDOW_MS, type Command } from "./history";
import {
  addItem,
  clampSpan,
  deleteItem,
  editText,
  moveItem,
  setItemSpan,
  setOverride,
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
