import type { Item, Project, ShapeGeometry, ShapeItem } from "$lib/model/project";
import type { Seconds } from "$lib/time";

/** How long a new shape lasts. */
export const NEW_SHAPE_SECONDS = 3;

/** The lowest layer with no item overlapping `[start, end)`. */
export function freeLayer(items: readonly Item[], start: Seconds, end: Seconds): number {
  const busy = new Set(items.filter((i) => i.start < end && i.end > start).map((i) => i.layer));
  let layer = 0;
  while (busy.has(layer)) layer++;
  return layer;
}

/**
 * A new shape at `time` with the first shape style, on the lowest free layer.
 * The span is clamped into the video when it's added.
 */
export function newShape(project: Project, shape: ShapeGeometry, time: Seconds): ShapeItem {
  const start = Math.min(time, Math.max(0, project.video.duration - NEW_SHAPE_SECONDS));
  const end = start + NEW_SHAPE_SECONDS;
  return {
    id: crypto.randomUUID(),
    type: "shape",
    start,
    end,
    layer: freeLayer(project.items, start, end),
    styleName: Object.keys(project.shapeStyles)[0],
    shape,
  };
}
