import type { TextItem, VideoRef } from "$lib/model/project";
import { parseAss } from "./parse";

export interface CaptionImport {
  items: TextItem[];
  /** What was left out, in a form fit to show the user. */
  notes: string[];
}

/**
 * Takes just the captions' timing, layer and text from an `.ass` file. The
 * file's styles, positions and inline formatting are dropped so the captions
 * follow the stylesheet: they all get `styleName`.
 */
export function importCaptions(text: string, video: VideoRef, styleName: string): CaptionImport {
  const { project, eventNotes } = parseAss(text, video);
  let stripped = 0;
  let drawings = 0;
  const items: TextItem[] = [];
  for (const item of project.items) {
    if (item.type !== "text") continue;
    // Vector drawings (\p1 and up) would turn into garbage as plain text.
    if (/\{[^}]*\\p[1-9]/.test(item.text)) {
      drawings++;
      continue;
    }
    const plain = item.text.replace(/\{[^}]*\}/g, "");
    if (plain !== item.text) stripped++;
    if (!plain.trim()) continue;
    const { id, start, end, layer } = item;
    items.push({ id, type: "text", start, end, layer, text: plain, styleName });
  }

  const notes = [...eventNotes];
  if (stripped > 0) {
    notes.push(`Formatting tags removed from ${stripped} caption${stripped === 1 ? "" : "s"}.`);
  }
  if (drawings > 0) notes.push(`${drawings} drawing${drawings === 1 ? "" : "s"} skipped.`);
  notes.push(`The file's styles aren't used; every caption uses "${styleName}".`);
  return { items, notes };
}
