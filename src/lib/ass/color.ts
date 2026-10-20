import type { Color } from "$lib/model/project";

// ASS colours are hex in BGR order with *transparency* rather than opacity:
// style fields are `&HAABBGGRR`, override tags `&HBBGGRR&` plus `&HAA&`.

function hex2(n: number): string {
  return n.toString(16).toUpperCase().padStart(2, "0");
}

/** `&HAABBGGRR` for a style field. */
export function styleColor(c: Color): string {
  return `&H${hex2(255 - c.a)}${hex2(c.b)}${hex2(c.g)}${hex2(c.r)}`;
}

/** `&HBBGGRR&` for `\1c`, `\3c`, `\4c` tags. */
export function tagColor(c: Color): string {
  return `&H${hex2(c.b)}${hex2(c.g)}${hex2(c.r)}&`;
}

/** `&HAA&` for `\1a`, `\3a`, `\4a` tags. */
export function tagAlpha(c: Color): string {
  return `&H${hex2(255 - c.a)}&`;
}

/**
 * Parses a style or tag colour (`&HAABBGGRR`, `&HBBGGRR&`, `&H...`, or a
 * decimal number, as some old files use). Missing alpha means opaque.
 */
export function parseColor(s: string): Color | null {
  const t = s.trim();
  const hex = /^&H([0-9A-Fa-f]{1,8})&?$/.exec(t);
  const value = hex ? parseInt(hex[1], 16) : /^-?\d+$/.test(t) ? Number(t) >>> 0 : NaN;
  if (Number.isNaN(value)) return null;
  return {
    r: value & 0xff,
    g: (value >>> 8) & 0xff,
    b: (value >>> 16) & 0xff,
    a: 255 - ((value >>> 24) & 0xff),
  };
}
