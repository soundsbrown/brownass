import type { AssStyle } from "./project";

/** Style sizes are defined in pixels of a frame with this many lines. */
export const REFERENCE_LINES = 1080;

/**
 * Factor from reference pixels to `playRes` pixels. Uses the shorter side,
 * so landscape, portrait and square videos all scale by their "lines".
 */
export function styleScale(playRes: { x: number; y: number }): number {
  return Math.min(playRes.x, playRes.y) / REFERENCE_LINES;
}

/** The style's sizes multiplied by `factor` (margins rounded, as ASS needs). */
export function scaleStyle(style: AssStyle, factor: number): AssStyle {
  return {
    ...style,
    fontSize: style.fontSize * factor,
    spacing: style.spacing * factor,
    outline: style.outline * factor,
    shadow: style.shadow * factor,
    blur: style.blur * factor,
    marginL: Math.round(style.marginL * factor),
    marginR: Math.round(style.marginR * factor),
    marginV: Math.round(style.marginV * factor),
  };
}

/** Converts a style in `playRes` pixels to reference pixels. */
export function unscaleStyle(style: AssStyle, factor: number): AssStyle {
  return {
    ...style,
    fontSize: style.fontSize / factor,
    spacing: style.spacing / factor,
    outline: style.outline / factor,
    shadow: style.shadow / factor,
    blur: style.blur / factor,
    marginL: style.marginL / factor,
    marginR: style.marginR / factor,
    marginV: style.marginV / factor,
  };
}
