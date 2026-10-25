import { describe, expect, it } from "vitest";
import type { Alignment } from "$lib/model/project";
import {
  drawingText,
  formatDrawing,
  normalizePath,
  parseDrawing,
  pathBounds,
  placeShape,
  type Box,
} from "./drawing";

function expectBox(actual: Box, expected: Box) {
  for (const k of ["x", "y", "w", "h"] as const) expect(actual[k]).toBeCloseTo(expected[k], 6);
}

describe("parseDrawing / formatDrawing", () => {
  it("round-trips and shares command letters", () => {
    const s = "m 0 0 l 10 0 10 5 b 10 7 8 9 5 9 m 20 20 l 21 21";
    const path = parseDrawing(s);
    expect(path).toHaveLength(6);
    expect(path[2]).toEqual({ op: "l", to: { x: 10, y: 5 } });
    expect(formatDrawing(path)).toBe(s);
  });

  it("scales and rounds, without negative zero", () => {
    const path = parseDrawing("m -0.001 1.126 l 2.5 3");
    expect(formatDrawing(path, 1, 2)).toBe("m 0 1.13 l 2.5 3");
    expect(drawingText(path)).toBe("m 0 5 l 10 12");
  });

  it("rejects malformed drawings", () => {
    expect(() => parseDrawing("m 0")).toThrow();
    expect(() => parseDrawing("x 1 2")).toThrow();
    expect(() => parseDrawing("1 2")).toThrow();
  });
});

describe("pathBounds", () => {
  it("includes curve extremes, not control points", () => {
    // A quarter-height bump: controls at y = -40, curve peak at y = -30.
    const path = parseDrawing("m 0 0 b 0 -40 100 -40 100 0");
    expectBox(pathBounds(path), { x: 0, y: -30, w: 100, h: 30 });
  });

  it("normalizes to the origin", () => {
    const { path, offset } = normalizePath(parseDrawing("m 5 7 l 15 7 15 17"));
    expect(offset).toEqual({ x: 5, y: 7 });
    expectBox(pathBounds(path), { x: 0, y: 0, w: 10, h: 10 });
  });
});

describe("placeShape", () => {
  const size = { w: 200, h: 100 };
  const margins = { marginL: 10, marginR: 30, marginV: 20 };

  const cases: [Alignment, number, number][] = [
    [1, 10, 960],
    [2, 850, 960],
    [3, 1690, 960],
    [4, 10, 490],
    [5, 850, 490],
    [6, 1690, 490],
    [7, 10, 20],
    [8, 850, 20],
    [9, 1690, 20],
  ];
  it.each(cases)("alignment %i at 1080p", (alignment, x, y) => {
    expect(placeShape(size, { alignment, ...margins }, { x: 1920, y: 1080 })).toEqual({ x, y });
  });

  it("works in any resolution", () => {
    const res = { x: 1280, y: 720 };
    expect(placeShape(size, { alignment: 3, ...margins }, res)).toEqual({ x: 1050, y: 600 });
    expect(placeShape(size, { alignment: 5, ...margins }, res)).toEqual({ x: 530, y: 310 });
  });
});
