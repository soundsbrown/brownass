<script lang="ts">
  import { untrack } from "svelte";
  import { inGesture, newGestureKey } from "$lib/commands/history";
  import { addItem, minDuration, setItemSpan } from "$lib/commands/items";
  import { projectStore } from "$lib/commands/store.svelte";
  import { DEFAULT_STYLE } from "$lib/model/defaults";
  import { player } from "$lib/player/player.svelte";
  import { selection } from "$lib/selection.svelte";
  import { formatTime } from "$lib/time";
  import { drawTimeline, type Colors } from "./draw";
  import { createSpan, moveSpan, resizeSpan, type SnapContext, type Span } from "./drag";
  import { geometry, hitTest, itemEdges, layoutRows, type Hit } from "./tracks";
  import {
    clampView,
    fitView,
    follow,
    panBy,
    timeAt,
    zoomAt,
    type Extent,
    type View,
  } from "./view";
  import { waveform } from "./waveform.svelte";

  const ZOOM_SPEED = 0.002;
  // Wheel deltas in lines (deltaMode 1) instead of pixels.
  const LINE_HEIGHT = 16;
  /** A drag in empty space shorter than this is a click, not a new subtitle. */
  const CREATE_THRESHOLD_PX = 4;

  type Gesture =
    | { kind: "scrub" }
    | { kind: "create"; anchor: number; layer: number; startX: number; span: Span | null }
    | { kind: "move"; id: string; offset: number; key: string }
    | { kind: "resize"; id: string; edge: "start" | "end"; key: string };

  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let width = $state(0);
  let height = $state(0);
  let view = $state<View>({ start: 0, pxPerSec: 1 });
  let gesture = $state.raw<Gesture | null>(null);
  let hover = $state.raw<Hit | null>(null);

  const extent = $derived<Extent>({ duration: player.duration, width, fps: player.fps });
  const items = $derived(projectStore.project?.items ?? []);
  const layout = $derived(layoutRows(items));
  const geo = $derived(geometry(height, layout.rowLayers.length));

  const cursor = $derived.by(() => {
    if (gesture?.kind === "move") return "grabbing";
    const hit = gesture?.kind === "resize" ? { kind: "item", part: "start" } : hover;
    if (hit?.kind === "item") return hit.part === "body" ? "grab" : "ew-resize";
    if (hit?.kind === "empty" && player.video) return "crosshair";
    return "default";
  });

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
      if (gesture?.kind !== "scrub") view = follow(view, extent, t);
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

  function pointerX(e: PointerEvent | MouseEvent): number {
    return Math.min(Math.max(e.offsetX, 0), width);
  }

  function hitAt(e: PointerEvent | MouseEvent): Hit {
    return hitTest(e.offsetX, e.offsetY, view, geo, items, layout);
  }

  /** Snap targets: playhead, video ends and other items' edges. Alt disables. */
  function snapContext(e: PointerEvent, exclude?: string): SnapContext {
    return {
      fps: player.fps,
      pxPerSec: view.pxPerSec,
      duration: player.duration,
      targets: [player.time, 0, player.duration, ...itemEdges(items, exclude)],
      snapToTargets: !e.altKey,
    };
  }

  function onPointerDown(e: PointerEvent) {
    const project = projectStore.project;
    if (e.button !== 0 || !player.video || !project) return;
    host.setPointerCapture(e.pointerId);
    const hit = hitAt(e);
    switch (hit.kind) {
      case "ruler":
        gesture = { kind: "scrub" };
        player.seek(timeAt(view, pointerX(e)));
        break;
      case "item": {
        selection.select(hit.id);
        const item = items.find((i) => i.id === hit.id);
        if (!item) return;
        const key = newGestureKey();
        gesture =
          hit.part === "body"
            ? { kind: "move", id: hit.id, offset: timeAt(view, pointerX(e)) - item.start, key }
            : { kind: "resize", id: hit.id, edge: hit.part, key };
        break;
      }
      case "empty":
        selection.select(null);
        gesture = {
          kind: "create",
          anchor: timeAt(view, pointerX(e)),
          layer: hit.layer,
          startX: e.offsetX,
          span: null,
        };
        break;
    }
  }

  function onPointerMove(e: PointerEvent) {
    const project = projectStore.project;
    if (!gesture || !project) {
      hover = player.video ? hitAt(e) : null;
      return;
    }
    const t = timeAt(view, pointerX(e));
    switch (gesture.kind) {
      case "scrub":
        player.seek(t);
        break;
      case "create":
        if (gesture.span || Math.abs(e.offsetX - gesture.startX) >= CREATE_THRESHOLD_PX) {
          const span = createSpan(gesture.anchor, t, minDuration(project), snapContext(e));
          gesture = { ...gesture, span };
        }
        break;
      case "move":
      case "resize": {
        const { id, key } = gesture;
        const item = items.find((i) => i.id === id);
        if (!item) return;
        const ctx = snapContext(e, id);
        const next =
          gesture.kind === "move"
            ? moveSpan(item, t - gesture.offset, ctx)
            : resizeSpan(item, gesture.edge, t, minDuration(project), ctx);
        projectStore.execute(inGesture(setItemSpan(id, next.start, next.end), key));
        break;
      }
    }
  }

  function onPointerUp(e: PointerEvent) {
    const project = projectStore.project;
    if (gesture?.kind === "create" && gesture.span && project) {
      const id = crypto.randomUUID();
      const styleName =
        DEFAULT_STYLE in project.styles ? DEFAULT_STYLE : Object.keys(project.styles)[0];
      const { start, end } = gesture.span;
      projectStore.execute(
        addItem({ id, type: "text", start, end, layer: gesture.layer, text: "", styleName }),
      );
      selection.select(id);
      selection.editText();
    }
    gesture = null;
    host.releasePointerCapture(e.pointerId);
    hover = hitAt(e);
  }

  function onDoubleClick(e: MouseEvent) {
    const hit = hitAt(e);
    const item = hit.kind === "item" ? items.find((i) => i.id === hit.id) : undefined;
    if (item) player.seek(item.start);
  }

  function cssVar(name: string): string {
    return getComputedStyle(host).getPropertyValue(name).trim();
  }

  function colors(): Colors {
    return {
      ruler: cssVar("--ruler"),
      track: cssVar("--track"),
      lane: cssVar("--lane"),
      border: cssVar("--border"),
      tick: cssVar("--muted"),
      label: cssVar("--fg"),
      grid: cssVar("--grid"),
      playhead: cssVar("--playhead"),
      wave: cssVar("--wave"),
      waveBg: cssVar("--wave-bg"),
      error: cssVar("--error"),
      itemSelected: cssVar("--item-selected"),
      itemText: cssVar("--item-text"),
    };
  }

  // Redraws whenever anything read here changes.
  $effect(() => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx || width === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTimeline(
      ctx,
      {
        view,
        width,
        height,
        geo,
        video: player.video,
        time: player.time,
        items,
        styleNames: Object.keys(projectStore.project?.styles ?? {}),
        layout,
        selectedId: selection.item?.id ?? null,
        ghost:
          gesture?.kind === "create" && gesture.span
            ? { span: gesture.span, layer: gesture.layer }
            : null,
        waveform: {
          data: waveform.data,
          status: waveform.status,
          progress: waveform.progress,
          error: waveform.error,
        },
      },
      colors(),
    );
  });
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
  style:cursor
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onpointerleave={() => (hover = null)}
  ondblclick={onDoubleClick}
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
