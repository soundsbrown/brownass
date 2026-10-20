<script lang="ts">
  import { untrack } from "svelte";
  import { player } from "$lib/player/player.svelte";
  import { formatTime } from "$lib/time";
  import {
    fitView,
    follow,
    panBy,
    pickTicks,
    timeAt,
    xAt,
    zoomAt,
    clampView,
    type Extent,
    type View,
  } from "./view";
  import { PEAK_TO_HEIGHT, peakBetween } from "./waveform";
  import { waveform } from "./waveform.svelte";

  const RULER_HEIGHT = 28;
  const HEAD_WIDTH = 13;
  const HEAD_HEIGHT = 16;
  const ZOOM_SPEED = 0.002;
  // Wheel deltas in lines (deltaMode 1) instead of pixels.
  const LINE_HEIGHT = 16;
  const WAVE_PADDING = 4;

  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let width = $state(0);
  let height = $state(0);
  let view = $state<View>({ start: 0, pxPerSec: 1 });
  let scrubbing = false;

  const extent = $derived<Extent>({ duration: player.duration, width, fps: player.fps });

  // Fit the whole video and load its waveform whenever a new one is loaded.
  $effect(() => {
    const video = player.video;
    untrack(() => {
      if (video) view = fitView(extent);
      waveform.load(video);
    });
  });

  // Keep the view valid when the timeline is resized.
  $effect(() => {
    const e = extent;
    untrack(() => (view = clampView(view, e)));
  });

  // Page the view when the playhead moves out of it (playback, frame steps).
  $effect(() => {
    const t = player.time;
    untrack(() => {
      if (!scrubbing) view = follow(view, extent, t);
    });
  });

  $effect(() => {
    const observer = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
    });
    observer.observe(host);
    return () => observer.disconnect();
  });

  // Wheel zooms around the cursor; Shift+wheel or horizontal scrolling pans.
  // Registered manually because the handler must be non-passive.
  $effect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!player.video) return;
      e.preventDefault();
      const scale = e.deltaMode === 1 ? LINE_HEIGHT : 1;
      const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (horizontal) {
        view = panBy(view, extent, (e.shiftKey ? e.deltaY : e.deltaX) * scale);
      } else {
        view = zoomAt(view, extent, e.offsetX, Math.exp(-e.deltaY * scale * ZOOM_SPEED));
      }
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  });

  function scrubTo(e: PointerEvent) {
    const x = Math.min(Math.max(e.offsetX, 0), width);
    player.seek(timeAt(view, x));
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !player.video) return;
    scrubbing = true;
    host.setPointerCapture(e.pointerId);
    scrubTo(e);
  }

  function onPointerMove(e: PointerEvent) {
    if (scrubbing) scrubTo(e);
  }

  function onPointerUp(e: PointerEvent) {
    scrubbing = false;
    host.releasePointerCapture(e.pointerId);
  }

  // Redraws whenever anything draw() reads changes, including player and
  // waveform state, since effects track reads made inside called functions.
  $effect(() => {
    draw(canvas, view, width, height, player.time);
  });

  function cssVar(name: string): string {
    return getComputedStyle(host).getPropertyValue(name).trim();
  }

  function draw(canvas: HTMLCanvasElement, v: View, w: number, h: number, time: number) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx || w === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const colors = {
      ruler: cssVar("--ruler"),
      lane: cssVar("--lane"),
      border: cssVar("--border"),
      tick: cssVar("--muted"),
      label: cssVar("--fg"),
      grid: cssVar("--grid"),
      playhead: cssVar("--playhead"),
      wave: cssVar("--wave"),
      waveBg: cssVar("--wave-bg"),
      error: cssVar("--error"),
    };

    ctx.fillStyle = colors.ruler;
    ctx.fillRect(0, 0, w, RULER_HEIGHT);
    ctx.fillStyle = colors.lane;
    ctx.fillRect(0, RULER_HEIGHT, w, h - RULER_HEIGHT);
    ctx.fillStyle = colors.border;
    ctx.fillRect(0, RULER_HEIGHT - 1, w, 1);

    const video = player.video;
    if (!video) return;

    if (video.audioCodec) {
      // The audio "clip" spans the video's duration, like a track in an NLE.
      const x0 = Math.max(0, xAt(v, 0));
      const x1 = Math.min(w, xAt(v, video.duration));
      ctx.fillStyle = colors.waveBg;
      ctx.fillRect(x0, RULER_HEIGHT, x1 - x0, h - RULER_HEIGHT);
    }

    drawTicks(ctx, v, w, h, video.fps, colors);

    const laneMid = (RULER_HEIGHT + h) / 2;
    if (waveform.data) {
      drawWaveform(ctx, v, w, h, video.duration, colors.wave);
    } else if (waveform.status === "loading") {
      const pct = Math.round(waveform.progress * 100);
      laneText(ctx, `Analyzing audio… ${pct}%`, w / 2, laneMid, colors.tick);
      ctx.fillStyle = colors.wave;
      ctx.fillRect(0, h - 2, w * waveform.progress, 2);
    } else if (waveform.status === "error") {
      laneText(ctx, `Waveform unavailable: ${waveform.error}`, w / 2, laneMid, colors.error);
    } else if (!video.audioCodec) {
      laneText(ctx, "No audio", w / 2, laneMid, colors.tick);
    }

    drawPlayhead(ctx, Math.round(xAt(v, time)) + 0.5, h, colors.playhead);
  }

  function drawTicks(
    ctx: CanvasRenderingContext2D,
    v: View,
    w: number,
    h: number,
    fps: number,
    colors: Record<string, string>,
  ) {
    const { major, subdivisions, decimals } = pickTicks(v.pxPerSec, fps);
    const minor = major / subdivisions;
    const end = timeAt(v, w);
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    // Step by index rather than accumulating time, so ticks stay exact.
    for (let i = Math.floor(v.start / minor); i * minor <= end; i++) {
      const x = Math.round(xAt(v, i * minor)) + 0.5;
      const isMajor = i % subdivisions === 0;
      ctx.fillStyle = colors.tick;
      const tick = isMajor ? 10 : 5;
      ctx.fillRect(x - 0.5, RULER_HEIGHT - 1 - tick, 1, tick);
      if (isMajor) {
        ctx.fillStyle = colors.grid;
        ctx.fillRect(x - 0.5, RULER_HEIGHT, 1, h - RULER_HEIGHT);
        ctx.fillStyle = colors.label;
        ctx.fillText(formatTime(i * minor, decimals), x + 4, 4);
      }
    }
  }

  // One symmetric bar per pixel column, on a dB scale (see PEAK_TO_HEIGHT).
  function drawWaveform(
    ctx: CanvasRenderingContext2D,
    v: View,
    w: number,
    h: number,
    duration: number,
    color: string,
  ) {
    const wf = waveform.data;
    if (!wf) return;
    const mid = (RULER_HEIGHT + h) / 2;
    const maxHalf = (h - RULER_HEIGHT) / 2 - WAVE_PADDING;
    const xEnd = Math.min(w, Math.ceil(xAt(v, duration)));
    ctx.fillStyle = color;
    for (let x = Math.max(0, Math.floor(xAt(v, 0))); x < xEnd; x++) {
      const half = PEAK_TO_HEIGHT[peakBetween(wf, timeAt(v, x), timeAt(v, x + 1))] * maxHalf;
      if (half > 0) ctx.fillRect(x, mid - half, 1, Math.max(1, half * 2));
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
</script>

<div
  class="timeline"
  bind:this={host}
  role="slider"
  tabindex="-1"
  aria-label="Timeline"
  aria-valuemin={0}
  aria-valuemax={player.duration}
  aria-valuenow={player.time}
  aria-valuetext={formatTime(player.time)}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
>
  <canvas bind:this={canvas}></canvas>
</div>

<style>
  .timeline {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    touch-action: none;
    user-select: none;
  }

  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
</style>
