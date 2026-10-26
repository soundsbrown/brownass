import { describe, expect, it } from "vitest";
import { createProject, defaultShapeStyle } from "$lib/model/defaults";
import type { Overlay, Project } from "$lib/model/project";
import { History } from "./history";
import {
  addOverlay,
  deleteOverlay,
  setHideOverlays,
  setOverlayGeometry,
  setOverlayStyle,
} from "./overlays";

const logo: Overlay = {
  id: "logo",
  styleName: "Corner",
  shape: { name: "logo.svg", width: 100, sourceWidth: 10, sourceHeight: 5, parts: [] },
};

function project(): Project {
  const p = createProject({ path: "v", width: 1920, height: 1080, fps: 25, duration: 60 });
  p.shapeStyles = { Corner: defaultShapeStyle(), Centre: defaultShapeStyle() };
  return p;
}

describe("overlay commands", () => {
  it("add and delete overlays", () => {
    const p = addOverlay(logo).apply(project());
    expect(p.overlays).toEqual([logo]);
    expect(addOverlay(logo).apply(p)).toBe(p);
    expect(deleteOverlay("logo").apply(p).overlays).toEqual([]);
    expect(deleteOverlay("other").apply(p)).toBe(p);
  });

  it("only use existing shape styles", () => {
    const p = addOverlay(logo).apply(project());
    expect(addOverlay({ ...logo, id: "x", styleName: "Default" }).apply(p)).toBe(p);
    expect(setOverlayStyle("logo", "Default").apply(p)).toBe(p);
    expect(setOverlayStyle("logo", "Centre").apply(p).overlays[0].styleName).toBe("Centre");
  });

  it("change the picture, coalescing typed widths", () => {
    const history = new History();
    let p = addOverlay(logo).apply(project());
    const start = p;
    p = history.execute(p, setOverlayGeometry("logo", { width: 120 }, "w"), 0);
    p = history.execute(p, setOverlayGeometry("logo", { width: 150 }, "w"), 100);
    expect(p.overlays[0].shape).toEqual({ ...logo.shape, width: 150 });
    expect(history.undo(p)).toBe(start);
    expect(setOverlayGeometry("logo", { width: 100 }).apply(start)).toBe(start);
  });

  it("hide overlays per video", () => {
    const p = setHideOverlays(true).apply(project());
    expect(p.hideOverlays).toBe(true);
    expect(setHideOverlays(true).apply(p)).toBe(p);
  });
});
