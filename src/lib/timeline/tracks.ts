import type { Item } from "$lib/model/project";
import type { Seconds } from "$lib/time";
import { xAt, type View } from "./view";

export const RULER_HEIGHT = 28;
const MAX_ROW_HEIGHT = 30;
const MIN_ROW_HEIGHT = 12;
/** The waveform lane keeps at least this much height below the rows. */
const MIN_WAVE_HEIGHT = 48;
/** Edges are grabbable within this many pixels (less on narrow boxes). */
const EDGE_GRAB = 6;

/**
 * Which subtitle row each item is drawn in. Each ASS layer gets its own rows,
 * highest layer on top (like tracks in an editor). Items that overlap within
 * a layer go into extra rows of that layer, so none are hidden.
 */
export interface RowLayout {
  rowOf: Map<string, number>;
  /** The layer of each row, top to bottom; at least one row. */
  rowLayers: number[];
}

export function layoutRows(items: readonly Item[]): RowLayout {
  const rowOf = new Map<string, number>();
  const rowLayers: number[] = [];
  const layers = [...new Set(items.map((i) => i.layer))].sort((a, b) => b - a);
  if (layers.length === 0) layers.push(0);

  for (const layer of layers) {
    const first = rowLayers.length;
    // End time of the last item placed in each of this layer's rows.
    const rowEnds: Seconds[] = [];
    const inLayer = items
      .filter((i) => i.layer === layer)
      .toSorted((a, b) => a.start - b.start || a.end - b.end);
    for (const item of inLayer) {
      let row = rowEnds.findIndex((end) => end <= item.start);
      if (row < 0) row = rowEnds.push(item.end) - 1;
      else rowEnds[row] = item.end;
      rowOf.set(item.id, first + row);
    }
    for (let r = 0; r < Math.max(1, rowEnds.length); r++) rowLayers.push(layer);
  }
  return { rowOf, rowLayers };
}

/** Vertical layout: ruler, subtitle rows, then the waveform lane. */
export interface Geometry {
  rowHeight: number;
  rowCount: number;
  /** Bottom of the last subtitle row; the waveform lane starts here. */
  tracksBottom: number;
  height: number;
}

export function geometry(height: number, rowCount: number): Geometry {
  const available = height - RULER_HEIGHT - MIN_WAVE_HEIGHT;
  const rowHeight = Math.max(
    MIN_ROW_HEIGHT,
    Math.min(MAX_ROW_HEIGHT, Math.floor(available / Math.max(1, rowCount))),
  );
  return { rowHeight, rowCount, tracksBottom: RULER_HEIGHT + rowHeight * rowCount, height };
}

export function rowTop(geo: Geometry, row: number): number {
  return RULER_HEIGHT + row * geo.rowHeight;
}

export type ItemPart = "start" | "end" | "body";

export type Hit =
  | { kind: "ruler" }
  | { kind: "item"; id: string; part: ItemPart }
  /** Empty space; `layer` is where a new item drawn here would go. */
  | { kind: "empty"; layer: number };

export function hitTest(
  x: number,
  y: number,
  view: View,
  geo: Geometry,
  items: readonly Item[],
  layout: RowLayout,
): Hit {
  if (y < RULER_HEIGHT) return { kind: "ruler" };
  if (y >= geo.tracksBottom) return { kind: "empty", layer: 0 };

  const row = Math.min(Math.floor((y - RULER_HEIGHT) / geo.rowHeight), geo.rowCount - 1);
  for (const item of items) {
    if (layout.rowOf.get(item.id) !== row) continue;
    const x0 = xAt(view, item.start);
    const x1 = xAt(view, item.end);
    if (x < x0 || x > x1) continue;
    // On narrow boxes, keep the middle third for moving.
    const edge = Math.min(EDGE_GRAB, (x1 - x0) / 3);
    const part: ItemPart = x - x0 < edge ? "start" : x1 - x < edge ? "end" : "body";
    return { kind: "item", id: item.id, part };
  }
  return { kind: "empty", layer: layout.rowLayers[row] };
}

/** The target closest to `t`, if within `thresholdPx`; otherwise `null`. */
export function nearestTarget(
  t: Seconds,
  targets: readonly Seconds[],
  pxPerSec: number,
  thresholdPx: number,
): Seconds | null {
  let best: Seconds | null = null;
  let bestDistance = thresholdPx / pxPerSec;
  for (const target of targets) {
    const d = Math.abs(target - t);
    if (d <= bestDistance) {
      best = target;
      bestDistance = d;
    }
  }
  return best;
}

/** Edges of all items except `exclude`, for snapping. */
export function itemEdges(items: readonly Item[], exclude?: string): Seconds[] {
  return items.flatMap((i) => (i.id === exclude ? [] : [i.start, i.end]));
}

/** Text to show on a timeline box: tags stripped, lines joined. */
export function previewText(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\[Nn]|\n/g, " ")
    .replace(/\\h/g, " ")
    .trim();
}
