import type { Color } from "$lib/model/project";

/** `#rrggbb` for an `<input type="color">` (opacity is edited separately). */
export function toHex(c: Color): string {
  return `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** Parses `#rrggbb`, keeping opacity `a`. Returns `null` if malformed. */
export function fromHex(hex: string, a: number): Color | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16), a };
}

/** Opacity as a 0-100 percentage, and back. */
export const toPercent = (a: number): number => Math.round((a / 255) * 100);
export const fromPercent = (p: number): number =>
  Math.round((Math.min(Math.max(p, 0), 100) / 100) * 255);
