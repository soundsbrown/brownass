import type { Alignment } from "$lib/model/project";

// ASS vector drawings (`{\p…}` events) restricted to move, line and cubic
// Bézier commands, which is all shapes and imported SVGs need.

export interface Point {
  x: number;
  y: number;
}

/** `m` starts a contour, `l` draws a line, `b` a cubic Bézier (2 controls + end). */
export type Command = { op: "m" | "l"; to: Point } | { op: "b"; c1: Point; c2: Point; to: Point };

export type Path = Command[];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Drawing precision: `\p3` divides coordinates by 4, giving quarter pixels. */
export const DRAWING_LEVEL = 3;
const DRAWING_UNITS = 2 ** (DRAWING_LEVEL - 1);

/** Parses `m x y l x y … b x y x y x y …`; a command letter applies until the next one. */
export function parseDrawing(s: string): Path {
  const tokens = s.trim().split(/\s+/).filter(Boolean);
  const path: Path = [];
  let op: string | null = null;
  let i = 0;
  const point = (): Point => {
    const x = Number(tokens[i++]);
    const y = Number(tokens[i++]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Bad drawing: ${s}`);
    return { x, y };
  };
  while (i < tokens.length) {
    if (/^[a-z]$/.test(tokens[i])) op = tokens[i++];
    if (op === "m" || op === "l") path.push({ op, to: point() });
    else if (op === "b") path.push({ op, c1: point(), c2: point(), to: point() });
    else throw new Error(`Bad drawing: ${s}`);
  }
  return path;
}

/**
 * Formats a path with coordinates multiplied by `scale` and rounded to
 * `decimals` (0 for `\p` integer units). Repeated commands share one letter.
 */
export function formatDrawing(path: Path, scale = 1, decimals = 2): string {
  const n = (v: number) => String(Number((v * scale).toFixed(decimals)) + 0);
  const p = (pt: Point) => `${n(pt.x)} ${n(pt.y)}`;
  const parts: string[] = [];
  let last: string | null = null;
  for (const c of path) {
    // `m` never repeats implicitly: a second pair after `m` would mean `l`.
    if (c.op !== last || c.op === "m") parts.push(c.op);
    last = c.op;
    parts.push(c.op === "b" ? `${p(c.c1)} ${p(c.c2)} ${p(c.to)}` : p(c.to));
  }
  return parts.join(" ");
}

/** The path in `\p` units, for an event drawn at `\p${DRAWING_LEVEL}`. */
export function drawingText(path: Path): string {
  return formatDrawing(path, DRAWING_UNITS, 0);
}

export function transformPath(path: Path, f: (p: Point) => Point): Path {
  return path.map((c) =>
    c.op === "b" ? { op: "b", c1: f(c.c1), c2: f(c.c2), to: f(c.to) } : { op: c.op, to: f(c.to) },
  );
}

export function scalePath(path: Path, sx: number, sy = sx): Path {
  return transformPath(path, (p) => ({ x: p.x * sx, y: p.y * sy }));
}

export function translatePath(path: Path, dx: number, dy: number): Path {
  return transformPath(path, (p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** Tight bounding box (Bézier extremes included, not just control points). */
export function pathBounds(path: Path): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  let current: Point = { x: 0, y: 0 };
  for (const c of path) {
    if (c.op === "b") {
      for (const t of bezierExtremes(current, c.c1, c.c2, c.to)) {
        const pt = bezierAt(current, c.c1, c.c2, c.to, t);
        add(pt.x, pt.y);
      }
    }
    add(c.to.x, c.to.y);
    current = c.to;
  }
  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function bezierAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** Parameters in (0, 1) where the curve's x or y derivative is zero. */
function bezierExtremes(p0: Point, p1: Point, p2: Point, p3: Point): number[] {
  const roots: number[] = [];
  for (const k of ["x", "y"] as const) {
    // Derivative / 3 = a t² + b t + c.
    const a = -p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k];
    const b = 2 * (p0[k] - 2 * p1[k] + p2[k]);
    const c = p1[k] - p0[k];
    if (Math.abs(a) < 1e-12) {
      if (Math.abs(b) > 1e-12) roots.push(-c / b);
      continue;
    }
    const disc = b * b - 4 * a * c;
    if (disc < 0) continue;
    const sq = Math.sqrt(disc);
    roots.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
  }
  return roots.filter((t) => t > 0 && t < 1);
}

/** Moves the path so its bounding box starts at (0, 0); returns the old origin too. */
export function normalizePath(path: Path): { path: Path; offset: Point } {
  const b = pathBounds(path);
  return { path: translatePath(path, -b.x, -b.y), offset: { x: b.x, y: b.y } };
}

/** The path's contours, each starting with its `m`. */
function contoursOf(path: Path): Path[] {
  const contours: Path[] = [];
  for (const c of path) {
    if (c.op === "m" || contours.length === 0) contours.push([]);
    contours[contours.length - 1].push(c);
  }
  return contours;
}

/** The contour drawn the other way round (same outline). */
function reverseContour(contour: Path): Path {
  // Point i is where command i ends; command i + 1 runs from it.
  const ends = contour.map((c) => c.to);
  const reversed: Path = [{ op: "m", to: ends[ends.length - 1] }];
  for (let i = contour.length - 1; i > 0; i--) {
    const c = contour[i];
    reversed.push(
      c.op === "b"
        ? { op: "b", c1: c.c2, c2: c.c1, to: ends[i - 1] }
        : { op: "l", to: ends[i - 1] },
    );
  }
  return reversed;
}

/**
 * Twice the signed area enclosed by the path, Bézier control points standing
 * in for their curves (close enough to tell which way it turns). Positive is
 * clockwise on screen.
 */
export function signedArea(path: Path): number {
  let area = 0;
  for (const contour of contoursOf(path)) {
    const points = contour.flatMap((c) => (c.op === "b" ? [c.c1, c.c2, c.to] : [c.to]));
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      area += a.x * b.y - b.x * a.y;
    }
  }
  return area;
}

/**
 * The path turning clockwise overall: every contour reversed if it turns the
 * other way. Filling is unchanged (libass uses the nonzero rule), but paths
 * combined into one drawing then add up instead of cancelling out.
 */
export function orientPositive(path: Path): Path {
  return signedArea(path) >= 0 ? path : contoursOf(path).flatMap(reverseContour);
}

export interface Placement {
  alignment: Alignment;
  marginL: number;
  marginR: number;
  marginV: number;
}

/**
 * Top-left corner for a `w`×`h` shape aligned like an ASS event with the given
 * alignment and margins (all in `playRes` pixels): left/right edges keep the
 * side margins, centred shapes sit between them; top/bottom keep the vertical
 * margin and middle is centred in the frame, as libass does.
 */
export function placeShape(
  size: { w: number; h: number },
  place: Placement,
  playRes: { x: number; y: number },
): Point {
  const column = (place.alignment - 1) % 3; // 0 left, 1 centre, 2 right
  const row = Math.floor((place.alignment - 1) / 3); // 0 bottom, 1 middle, 2 top
  const x =
    column === 0
      ? place.marginL
      : column === 2
        ? playRes.x - place.marginR - size.w
        : place.marginL + (playRes.x - place.marginL - place.marginR - size.w) / 2;
  const y =
    row === 2
      ? place.marginV
      : row === 0
        ? playRes.y - place.marginV - size.h
        : (playRes.y - size.h) / 2;
  return { x, y };
}
