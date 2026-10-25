import { invoke } from "@tauri-apps/api/core";
import type { Color, ShapeGeometry } from "$lib/model/project";
import { session } from "$lib/session.svelte";

/** An SVG converted to drawings by the backend. */
export interface ImportedSvg {
  name: string;
  /** Size of the drawn area, in SVG units. */
  width: number;
  height: number;
  parts: { color: Color; path: string }[];
  /** Things that couldn't be imported as they look. */
  warnings: string[];
}

/** New SVG shapes fit in a box this big (1080-line reference pixels). */
const NEW_SVG_SIZE = 400;

/** Shows the import dialog and converts the choice; `null` if cancelled. */
export function importSvg(): Promise<ImportedSvg | null> {
  return invoke<ImportedSvg | null>("import_svg");
}

/**
 * Runs the import dialog, reporting failures and anything that couldn't be
 * imported as it looks in the status bar. `null` if cancelled or failed.
 */
export async function chooseSvg(): Promise<ImportedSvg | null> {
  try {
    const svg = await importSvg();
    const notes = svg?.warnings ?? [];
    if (svg && notes.length) {
      session.prompt = {
        kind: "message",
        tone: "info",
        text: `Imported ${svg.name}: ${notes.length} note${notes.length === 1 ? "" : "s"} (hover).`,
        details: notes,
      };
    }
    return svg;
  } catch (e) {
    session.prompt = { kind: "message", tone: "error", text: String(e) };
    return null;
  }
}

/** Shape geometry for a new imported SVG, fitted into the default box. */
export function svgGeometry(svg: ImportedSvg): ShapeGeometry {
  const fit = NEW_SVG_SIZE / Math.max(svg.width, svg.height);
  return {
    name: svg.name,
    width: svg.width * fit,
    sourceWidth: svg.width,
    sourceHeight: svg.height,
    parts: svg.parts,
  };
}
