/** Override tags the formatting buttons insert. */
export type FormatTag = "b" | "i" | "u";

export interface Edit {
  text: string;
  /** The selection afterwards: the wrapped text, or the caret between tags. */
  selectionStart: number;
  selectionEnd: number;
}

/** Wraps `text[start, end)` in `{\tag1}…{\tag0}`. */
export function wrapInTag(text: string, start: number, end: number, tag: FormatTag): Edit {
  const open = `{\\${tag}1}`;
  const close = `{\\${tag}0}`;
  const [from, to] = start <= end ? [start, end] : [end, start];
  return {
    text: text.slice(0, from) + open + text.slice(from, to) + close + text.slice(to),
    selectionStart: from + open.length,
    selectionEnd: to + open.length,
  };
}
