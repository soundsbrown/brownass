import type { Item } from "$lib/model/project";
import type { VideoInfo } from "$lib/player/api";
import { formatTime, type Seconds } from "$lib/time";
import type { Span } from "./drag";
import { RULER_HEIGHT, previewText, rowTop, type Geometry, type RowLayout } from "./tracks";
import { pickTicks, timeAt, xAt, type View } from "./view";
import { PEAK_TO_HEIGHT, peakBetween, type Waveform } from "./waveform";

const HEAD_WIDTH = 13;
const HEAD_HEIGHT = 16;
const WAVE_PADDING = 4;

export interface Colors {
  ruler: string;
  track: string;
  lane: string;
  border: string;
  tick: string;
  label: string;
  grid: string;
  playhead: string;
  wave: string;
  waveBg: string;
  error: string;
  item: string;
  itemSelected: string;
  itemText: string;
}

/** Everything the timeline shows, as plain data. */
export interface Scene {
  view: View;
  width: number;
  height: number;
  geo: Geometry;
  video: VideoInfo | null;
  time: Seconds;
  items: readonly Item[];
  layout: RowLayout;
  selectedId: string | null;
  /** A subtitle being drawn by dragging, and the layer it will go on. */
  ghost: { span: Span; layer: number } | null;
  waveform: {
    data: Waveform | null;
    status: string;
    progress: number;
    error: string | null;
  };
}

export function drawTimeline(ctx: CanvasRenderingContext2D, s: Scene, c: Colors): void {
  const { width: w, height: h, geo } = s;
  ctx.fillStyle = c.ruler;
  ctx.fillRect(0, 0, w, RULER_HEIGHT);
  ctx.fillStyle = c.track;
  ctx.fillRect(0, RULER_HEIGHT, w, geo.tracksBottom - RULER_HEIGHT);
  ctx.fillStyle = c.lane;
  ctx.fillRect(0, geo.tracksBottom, w, h - geo.tracksBottom);
  ctx.fillStyle = c.border;
  ctx.fillRect(0, RULER_HEIGHT - 1, w, 1);
  for (let row = 1; row <= geo.rowCount; row++) {
    ctx.fillRect(0, rowTop(geo, row) - 1, w, 1);
  }

  const video = s.video;
  if (!video) return;

  if (video.audioCodec) {
    // The audio "clip" spans the video's duration, like a track in an NLE.
    const x0 = Math.max(0, xAt(s.view, 0));
    const x1 = Math.min(w, xAt(s.view, video.duration));
    ctx.fillStyle = c.waveBg;
    ctx.fillRect(x0, geo.tracksBottom, x1 - x0, h - geo.tracksBottom);
  }

  drawTicks(ctx, s, video.fps, c);
  drawLane(ctx, s, video, c);
  drawItems(ctx, s, c);
  drawPlayhead(ctx, Math.round(xAt(s.view, s.time)) + 0.5, h, c.playhead);
}

function drawTicks(ctx: CanvasRenderingContext2D, s: Scene, fps: number, c: Colors) {
  const { major, subdivisions, decimals } = pickTicks(s.view.pxPerSec, fps);
  const minor = major / subdivisions;
  const end = timeAt(s.view, s.width);
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  // Step by index rather than accumulating time, so ticks stay exact.
  for (let i = Math.floor(s.view.start / minor); i * minor <= end; i++) {
    const x = Math.round(xAt(s.view, i * minor)) + 0.5;
    const isMajor = i % subdivisions === 0;
    ctx.fillStyle = c.tick;
    const tick = isMajor ? 10 : 5;
    ctx.fillRect(x - 0.5, RULER_HEIGHT - 1 - tick, 1, tick);
    if (isMajor) {
      ctx.fillStyle = c.grid;
      ctx.fillRect(x - 0.5, RULER_HEIGHT, 1, s.height - RULER_HEIGHT);
      ctx.fillStyle = c.label;
      ctx.fillText(formatTime(i * minor, decimals), x + 4, 4);
    }
  }
}

function drawLane(ctx: CanvasRenderingContext2D, s: Scene, video: VideoInfo, c: Colors) {
  const top = s.geo.tracksBottom;
  const mid = (top + s.height) / 2;
  const wf = s.waveform;
  if (wf.data) {
    drawWaveform(ctx, s, wf.data, video.duration, c.wave);
  } else if (wf.status === "loading") {
    laneText(ctx, `Analyzing audio… ${Math.round(wf.progress * 100)}%`, s.width / 2, mid, c.tick);
    ctx.fillStyle = c.wave;
    ctx.fillRect(0, s.height - 2, s.width * wf.progress, 2);
  } else if (wf.status === "error") {
    laneText(ctx, `Waveform unavailable: ${wf.error}`, s.width / 2, mid, c.error);
  } else if (!video.audioCodec) {
    laneText(ctx, "No audio", s.width / 2, mid, c.tick);
  }
}

// One symmetric bar per pixel column, on a dB scale (see PEAK_TO_HEIGHT).
function drawWaveform(
  ctx: CanvasRenderingContext2D,
  s: Scene,
  wf: Waveform,
  duration: Seconds,
  color: string,
) {
  const top = s.geo.tracksBottom;
  const mid = (top + s.height) / 2;
  const maxHalf = (s.height - top) / 2 - WAVE_PADDING;
  const xEnd = Math.min(s.width, Math.ceil(xAt(s.view, duration)));
  ctx.fillStyle = color;
  for (let x = Math.max(0, Math.floor(xAt(s.view, 0))); x < xEnd; x++) {
    const peak = peakBetween(wf, timeAt(s.view, x), timeAt(s.view, x + 1));
    const half = PEAK_TO_HEIGHT[peak] * maxHalf;
    if (half > 0) ctx.fillRect(x, mid - half, 1, Math.max(1, half * 2));
  }
}

function drawItems(ctx: CanvasRenderingContext2D, s: Scene, c: Colors) {
  const visibleStart = s.view.start;
  const visibleEnd = timeAt(s.view, s.width);
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  for (const item of s.items) {
    if (item.end < visibleStart || item.start > visibleEnd) continue;
    const row = s.layout.rowOf.get(item.id);
    if (row === undefined) continue;
    const label = item.type === "text" ? previewText(item.text) : "";
    drawBox(ctx, s, row, item, item.id === s.selectedId, label, c);
  }

  if (s.ghost) {
    const row = s.layout.rowLayers.indexOf(s.ghost.layer);
    const y = rowTop(s.geo, row < 0 ? s.geo.rowCount - 1 : row);
    const x0 = xAt(s.view, s.ghost.span.start);
    const x1 = xAt(s.view, s.ghost.span.end);
    ctx.save();
    ctx.strokeStyle = c.itemSelected;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(
      Math.round(x0) + 0.5,
      y + 1.5,
      Math.max(1, Math.round(x1 - x0) - 1),
      s.geo.rowHeight - 4,
    );
    ctx.restore();
  }
}

function drawBox(
  ctx: CanvasRenderingContext2D,
  s: Scene,
  row: number,
  item: Item,
  selected: boolean,
  label: string,
  c: Colors,
) {
  const y = rowTop(s.geo, row) + 1;
  const h = s.geo.rowHeight - 3;
  // Clamp to just outside the canvas so huge zooms don't overflow.
  const x0 = Math.max(-2, Math.round(xAt(s.view, item.start)));
  const x1 = Math.min(s.width + 2, Math.round(xAt(s.view, item.end)));
  // A 1 px gap at the end keeps touching subtitles visibly separate.
  const width = Math.max(1, x1 - x0 - 1);

  ctx.fillStyle = selected ? c.itemSelected : c.item;
  ctx.fillRect(x0, y, width, h);
  if (selected) {
    ctx.strokeStyle = c.itemText;
    ctx.strokeRect(x0 + 0.5, y + 0.5, width - 1, h - 1);
  }
  if (label && width > 14 && h >= 12) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 + 4, y, width - 8, h);
    ctx.clip();
    ctx.fillStyle = c.itemText;
    ctx.fillText(label, Math.max(x0, 0) + 5, y + h / 2 + 1);
    ctx.restore();
  }
}

function laneText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

// A downward-pointing marker on the ruler, with a line through the lanes.
function drawPlayhead(ctx: CanvasRenderingContext2D, x: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x - 0.5, 0, 1, h);
  const half = HEAD_WIDTH / 2;
  ctx.beginPath();
  ctx.moveTo(x - half, 0);
  ctx.lineTo(x + half, 0);
  ctx.lineTo(x + half, HEAD_HEIGHT - half);
  ctx.lineTo(x, HEAD_HEIGHT);
  ctx.lineTo(x - half, HEAD_HEIGHT - half);
  ctx.closePath();
  ctx.fill();
}
