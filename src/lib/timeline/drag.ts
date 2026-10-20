import type { Seconds } from "$lib/time";
import { nearestTarget } from "./tracks";

/** Edges snap to targets (playhead, other items) within this distance. */
const SNAP_PX = 8;

export interface SnapContext {
  fps: number;
  pxPerSec: number;
  duration: Seconds;
  /** Times edges snap to; ignored when `snapToTargets` is false. */
  targets: readonly Seconds[];
  snapToTargets: boolean;
}

export interface Span {
  start: Seconds;
  end: Seconds;
}

function frameTime(t: Seconds, fps: number): Seconds {
  return Math.round(t * fps) / fps;
}

function clamp(t: Seconds, min: Seconds, max: Seconds): Seconds {
  return Math.min(Math.max(t, min), max);
}

/** The nearest target within reach, else the nearest frame boundary. */
export function snapTime(t: Seconds, ctx: SnapContext): Seconds {
  const target = ctx.snapToTargets ? nearestTarget(t, ctx.targets, ctx.pxPerSec, SNAP_PX) : null;
  return clamp(target ?? frameTime(t, ctx.fps), 0, ctx.duration);
}

/**
 * Moves a span so it starts at `start` (keeping its length). Whichever edge
 * is closer to a target snaps to it; otherwise the start lands on a frame.
 */
export function moveSpan(span: Span, start: Seconds, ctx: SnapContext): Span {
  const length = span.end - span.start;
  let s = frameTime(start, ctx.fps);
  if (ctx.snapToTargets) {
    const byStart = nearestTarget(start, ctx.targets, ctx.pxPerSec, SNAP_PX);
    const byEnd = nearestTarget(start + length, ctx.targets, ctx.pxPerSec, SNAP_PX);
    const startDistance = byStart === null ? Infinity : Math.abs(byStart - start);
    const endDistance = byEnd === null ? Infinity : Math.abs(byEnd - (start + length));
    if (byStart !== null && startDistance <= endDistance) s = byStart;
    else if (byEnd !== null) s = byEnd - length;
  }
  s = clamp(s, 0, Math.max(0, ctx.duration - length));
  return { start: s, end: s + length };
}

/** Drags one edge to `t`, keeping the span at least `minLength` long. */
export function resizeSpan(
  span: Span,
  edge: "start" | "end",
  t: Seconds,
  minLength: Seconds,
  ctx: SnapContext,
): Span {
  const snapped = snapTime(t, ctx);
  return edge === "start"
    ? { start: Math.min(snapped, span.end - minLength), end: span.end }
    : { start: span.start, end: Math.max(snapped, span.start + minLength) };
}

/** The span between where a drag started and where it is now. */
export function createSpan(
  anchor: Seconds,
  t: Seconds,
  minLength: Seconds,
  ctx: SnapContext,
): Span {
  const a = snapTime(anchor, ctx);
  const b = snapTime(t, ctx);
  const start = Math.min(a, b);
  const end = Math.max(a, b, start + minLength);
  if (end <= ctx.duration) return { start, end };
  return { start: Math.max(0, ctx.duration - minLength), end: ctx.duration };
}
