import type { Seconds } from "$lib/time";

/** The visible part of the timeline. */
export interface View {
  /** Time at the left edge. */
  start: Seconds;
  pxPerSec: number;
}

/** What the view is constrained by. */
export interface Extent {
  duration: Seconds;
  /** Width of the timeline in CSS pixels. */
  width: number;
  fps: number;
}

/** Furthest zoom-in, in pixels per video frame. */
const MAX_PX_PER_FRAME = 60;
/** How far into the view the playhead lands when the view pages to follow it. */
const FOLLOW_MARGIN = 0.05;
/** Major ticks are labelled, so they need room for a label. */
const MIN_MAJOR_SPACING = 90;
const MIN_MINOR_SPACING = 7;

const SECOND_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
const FRAME_STEPS = [1, 2, 5, 10];
const SUBDIVISIONS = [10, 5, 4, 2];

export function xAt(view: View, t: Seconds): number {
  return (t - view.start) * view.pxPerSec;
}

export function timeAt(view: View, x: number): Seconds {
  return view.start + x / view.pxPerSec;
}

/** Zoom limits: fully zoomed out shows the whole video. */
export function zoomRange(extent: Extent): [min: number, max: number] {
  const max = extent.fps * MAX_PX_PER_FRAME;
  const min = extent.duration > 0 ? extent.width / extent.duration : max;
  return [Math.min(min, max), max];
}

export function clampView(view: View, extent: Extent): View {
  const [min, max] = zoomRange(extent);
  const pxPerSec = Math.min(Math.max(view.pxPerSec, min), max);
  const visible = extent.width / pxPerSec;
  const start = Math.min(Math.max(view.start, 0), Math.max(0, extent.duration - visible));
  return { start, pxPerSec };
}

export function fitView(extent: Extent): View {
  return clampView({ start: 0, pxPerSec: 0 }, extent);
}

/** Zooms by `factor`, keeping the time under `x` in place. */
export function zoomAt(view: View, extent: Extent, x: number, factor: number): View {
  const anchor = timeAt(view, x);
  const [min, max] = zoomRange(extent);
  const pxPerSec = Math.min(Math.max(view.pxPerSec * factor, min), max);
  return clampView({ start: anchor - x / pxPerSec, pxPerSec }, extent);
}

export function panBy(view: View, extent: Extent, dx: number): View {
  return clampView({ ...view, start: view.start + dx / view.pxPerSec }, extent);
}

/** Pages the view so `t` is visible; returns `view` unchanged if it already is. */
export function follow(view: View, extent: Extent, t: Seconds): View {
  const x = xAt(view, t);
  if (x >= 0 && x <= extent.width) return view;
  const visible = extent.width / view.pxPerSec;
  return clampView({ ...view, start: t - visible * FOLLOW_MARGIN }, extent);
}

export interface Ticks {
  /** Spacing of labelled ticks, in seconds. */
  major: Seconds;
  /** Number of minor intervals per major interval (1 = no minor ticks). */
  subdivisions: number;
  /** Fractional digits needed in labels. */
  decimals: number;
}

/**
 * Picks tick spacing for a zoom level. Below one second, steps are whole
 * frames so ticks line up with frames.
 */
export function pickTicks(pxPerSec: number, fps: number): Ticks {
  const frameSteps = FRAME_STEPS.map((f) => f / fps).filter((s) => s < 1);
  const steps = [...frameSteps, ...SECOND_STEPS];
  const major = steps.find((s) => s * pxPerSec >= MIN_MAJOR_SPACING) ?? steps[steps.length - 1];

  const frames = Math.round(major * fps);
  const isFrameStep = major < 1;
  const subdivisions =
    SUBDIVISIONS.find(
      (n) => (major / n) * pxPerSec >= MIN_MINOR_SPACING && (!isFrameStep || frames % n === 0),
    ) ?? 1;

  return { major, subdivisions, decimals: isFrameStep ? 2 : 0 };
}
