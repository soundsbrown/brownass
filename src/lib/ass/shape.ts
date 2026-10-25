import type { Color, ShapeGeometry } from "$lib/model/project";
import { parseDrawing, pathBounds, scalePath, type Box, type Path } from "./drawing";

/** One colour of a shape. */
export interface ShapePart {
  color: Color;
  path: Path;
}

/**
 * The shape's drawings in reference pixels, bounding box at (0, 0). Adjacent
 * parts of the same colour are merged, so each colour run is one event.
 */
export function shapeParts(shape: ShapeGeometry): ShapePart[] {
  const scale = shape.width / shape.sourceWidth;
  const parts: ShapePart[] = [];
  for (const part of shape.parts) {
    // Invisible parts (such as a transparent background) would still cast a
    // shadow and get an outline.
    if (part.color.a === 0) continue;
    const path = scalePath(parseDrawing(part.path), scale);
    const last = parts.at(-1);
    if (last && sameColor(last.color, part.color)) last.path = [...last.path, ...path];
    else parts.push({ color: part.color, path });
  }
  return parts;
}

/** The bounding box of all parts together. */
export function partsBounds(parts: ShapePart[]): Box {
  const boxes = parts.filter((p) => p.path.length > 0).map((p) => pathBounds(p.path));
  if (boxes.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
}

function sameColor(a: Color, b: Color): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}
