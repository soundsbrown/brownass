/** Video time in seconds. */
export type Seconds = number;

// Guards against float error when a frame's start time is multiplied back by
// the frame rate (e.g. 1001/30000 * 30000/1001 = 0.9999999).
const FRAME_EPSILON = 1e-6;

/** Index of the frame shown at time `t`. */
export function frameAt(t: Seconds, fps: number): number {
  return Math.floor(t * fps + FRAME_EPSILON);
}

/** Start time of frame `frame`. */
export function timeOfFrame(frame: number, fps: number): Seconds {
  return frame / fps;
}

/** Number of frames in a video of the given duration (at least 1). */
export function frameCount(duration: Seconds, fps: number): number {
  return Math.max(1, Math.round(duration * fps));
}

/**
 * Formats a time as `H:MM:SS`, with `decimals` fractional digits (0-3).
 * Rounds first, so 59.9996 with 3 decimals becomes `0:01:00.000`.
 */
export function formatTime(t: Seconds, decimals = 3): string {
  const scale = 10 ** decimals;
  const units = Math.round(Math.max(0, t) * scale);
  const totalSeconds = Math.floor(units / scale);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const base = `${h}:${pad(m, 2)}:${pad(s, 2)}`;
  return decimals > 0 ? `${base}.${pad(units % scale, decimals)}` : base;
}

/**
 * Formats an ASS timestamp, `H:MM:SS.cc`. ASS only has centisecond precision,
 * so this rounds *down*: for a frame's start time that gives a timestamp after
 * the previous frame starts and no later than this one, so renderers switch
 * events on exactly that frame (for frame rates below 100 fps).
 */
export function formatAssTime(t: Seconds): string {
  const cs = Math.floor(Math.max(0, t) * 100 + FRAME_EPSILON);
  const totalSeconds = Math.floor(cs / 100);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return `${h}:${pad(m, 2)}:${pad(totalSeconds % 60, 2)}.${pad(cs % 100, 2)}`;
}

/** Parses an ASS timestamp (`H:MM:SS.cc`); returns `null` if malformed. */
export function parseAssTime(s: string): Seconds | null {
  const m = /^\s*(\d+):(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?\s*$/.exec(s);
  if (!m) return null;
  const [, h, min, sec, frac = ""] = m;
  // Fractions are hundredths in ASS, but be lenient about the digit count.
  const fraction = frac ? Number(frac) / 10 ** frac.length : 0;
  return Number(h) * 3600 + Number(min) * 60 + Number(sec) + fraction;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}
