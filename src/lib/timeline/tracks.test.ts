import { describe, expect, it } from "vitest";
import type { TextItem } from "$lib/model/project";
import {
  RULER_HEIGHT,
  geometry,
  hitTest,
  itemEdges,
  layoutRows,
  nearestTarget,
  previewText,
} from "./tracks";

function item(id: string, start: number, end: number, layer = 0): TextItem {
  return { id, type: "text", start, end, layer, text: "", styleName: "Default" };
}

describe("layoutRows", () => {
  it("has one row even without items", () => {
    expect(layoutRows([]).rowLayers).toEqual([0]);
  });

  it("puts non-overlapping items of a layer in one row", () => {
    const { rowOf, rowLayers } = layoutRows([item("a", 0, 2), item("b", 2, 3), item("c", 5, 6)]);
    expect(rowLayers).toEqual([0]);
    expect([...rowOf.values()]).toEqual([0, 0, 0]);
  });

  it("stacks overlapping items into extra rows of their layer", () => {
    const { rowOf, rowLayers } = layoutRows([
      item("a", 0, 4),
      item("b", 1, 2),
      item("c", 3, 5),
      item("d", 4.5, 6),
    ]);
    expect(rowLayers).toEqual([0, 0]);
    expect(Object.fromEntries(rowOf)).toEqual({ a: 0, b: 1, c: 1, d: 0 });
  });

  it("orders layers top to bottom from highest", () => {
    const { rowOf, rowLayers } = layoutRows([item("a", 0, 1, 0), item("b", 0, 1, 3)]);
    expect(rowLayers).toEqual([3, 0]);
    expect(rowOf.get("b")).toBe(0);
    expect(rowOf.get("a")).toBe(1);
  });
});

describe("geometry", () => {
  it("shrinks rows to leave room for the waveform", () => {
    expect(geometry(200, 1).rowHeight).toBe(30);
    expect(geometry(200, 10).rowHeight).toBe(12);
    expect(geometry(200, 5).tracksBottom).toBe(RULER_HEIGHT + 5 * 24);
  });
});

describe("hitTest", () => {
  const view = { start: 0, pxPerSec: 100 };
  const items = [item("a", 1, 2), item("b", 1.5, 1.6)];
  const layout = layoutRows(items);
  const geo = geometry(200, layout.rowLayers.length);
  const rowY = (row: number) => RULER_HEIGHT + row * geo.rowHeight + 5;

  it("finds the ruler, items, item edges and empty space", () => {
    expect(hitTest(150, 10, view, geo, items, layout)).toEqual({ kind: "ruler" });
    expect(hitTest(150, rowY(0), view, geo, items, layout)).toEqual({
      kind: "item",
      id: "a",
      part: "body",
    });
    expect(hitTest(102, rowY(0), view, geo, items, layout)).toMatchObject({ part: "start" });
    expect(hitTest(197, rowY(0), view, geo, items, layout)).toMatchObject({ part: "end" });
    expect(hitTest(50, rowY(0), view, geo, items, layout)).toEqual({ kind: "empty", layer: 0 });
    expect(hitTest(50, 190, view, geo, items, layout)).toEqual({ kind: "empty", layer: 0 });
  });

  it("keeps the middle of narrow boxes movable", () => {
    // "b" is 10 px wide, in the second row.
    expect(hitTest(155, rowY(1), view, geo, items, layout)).toMatchObject({
      id: "b",
      part: "body",
    });
    expect(hitTest(151, rowY(1), view, geo, items, layout)).toMatchObject({
      id: "b",
      part: "start",
    });
  });
});

describe("snapping", () => {
  it("picks the closest target within the threshold", () => {
    expect(nearestTarget(1.03, [1, 1.05, 2], 100, 8)).toBe(1.05);
    expect(nearestTarget(1.5, [1, 2], 100, 8)).toBeNull();
  });

  it("lists edges of other items", () => {
    expect(itemEdges([item("a", 1, 2), item("b", 3, 4)], "a")).toEqual([3, 4]);
  });
});

describe("previewText", () => {
  it("strips tags and joins lines", () => {
    expect(previewText("{\\an8}Hello\\Nworld\n{\\i1}again{\\i0}")).toBe("Hello world again");
  });
});
