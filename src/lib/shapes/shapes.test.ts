import { describe, expect, it } from "vitest";
import { createProject, defaultShapeStyle } from "$lib/model/defaults";
import type { Item } from "$lib/model/project";
import type { ShapeGeometry } from "$lib/model/project";
import { freeLayer, newShape } from "./shapes";

const logo: ShapeGeometry = {
  name: "logo.svg",
  width: 400,
  sourceWidth: 10,
  sourceHeight: 10,
  parts: [{ color: { r: 0, g: 0, b: 0, a: 255 }, path: "m 0 0 l 10 0 10 10" }],
};

const text = (layer: number, start: number, end: number): Item => ({
  id: `${layer}-${start}`,
  type: "text",
  start,
  end,
  layer,
  text: "",
  styleName: "Default",
});

describe("freeLayer", () => {
  it("skips layers busy at that time", () => {
    const items = [text(0, 0, 5), text(1, 4, 6), text(2, 10, 12)];
    expect(freeLayer(items, 1, 3)).toBe(1);
    expect(freeLayer(items, 4.5, 7)).toBe(2);
    expect(freeLayer(items, 6, 8)).toBe(0);
  });
});

describe("newShape", () => {
  const project = {
    ...createProject({ path: "v", width: 1920, height: 1080, fps: 25, duration: 10 }),
    shapeStyles: { Box: defaultShapeStyle(), Other: defaultShapeStyle() },
  };

  it("starts at the time with the first shape style", () => {
    const s = newShape(project, logo, 2);
    expect(s).toMatchObject({ type: "shape", start: 2, end: 5, layer: 0, styleName: "Box" });
  });

  it("fits before the end of the video", () => {
    expect(newShape(project, logo, 9)).toMatchObject({ start: 7, end: 10 });
  });
});
