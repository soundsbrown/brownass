import { invoke } from "@tauri-apps/api/core";
import type { Project } from "$lib/model/project";

/** Font files for a font name, from the system font index (none if missing). */
export async function fontFiles(name: string): Promise<Uint8Array<ArrayBuffer>[]> {
  return decodeFontFiles(await invoke<ArrayBuffer>("font_files", { name }));
}

/** Which of `names` aren't installed. */
export function missingFonts(names: string[]): Promise<string[]> {
  return invoke<string[]>("missing_fonts", { names });
}

/**
 * Decodes `[u32 count]([u32 length][bytes])*` (little-endian). Each file gets
 * its own buffer: posting a view to a worker would copy the whole buffer.
 */
export function decodeFontFiles(buffer: ArrayBuffer): Uint8Array<ArrayBuffer>[] {
  const view = new DataView(buffer);
  const files: Uint8Array<ArrayBuffer>[] = [];
  let offset = 4;
  for (let i = 0, count = view.getUint32(0, true); i < count; i++) {
    const length = view.getUint32(offset, true);
    files.push(new Uint8Array(buffer.slice(offset + 4, offset + 4 + length)));
    offset += 4 + length;
  }
  return files;
}

/**
 * Every font name the project refers to: styles, per-item overrides and
 * `\fn` tags typed into the text. Sorted, without duplicates (ignoring case).
 */
export function fontsUsed(project: Project): string[] {
  const names = new Map<string, string>();
  const add = (name: string | undefined) => {
    const trimmed = name?.trim().replace(/^@/, "");
    if (trimmed && !names.has(trimmed.toLowerCase())) names.set(trimmed.toLowerCase(), trimmed);
  };
  for (const style of Object.values(project.styles)) add(style.fontName);
  for (const item of project.items) {
    if (item.type !== "text") continue;
    add(item.overrides?.fontName);
    for (const block of item.text.matchAll(/\{([^}]*)\}/g)) {
      for (const tag of block[1].matchAll(/\\fn([^\\}]*)/g)) add(tag[1]);
    }
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}
