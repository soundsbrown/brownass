<script lang="ts">
  import FfmpegStatus from "$lib/ffmpeg/FfmpegStatus.svelte";
  import Sidebar from "$lib/panels/Sidebar.svelte";
  import Transport from "$lib/player/Transport.svelte";
  import VideoView from "$lib/player/VideoView.svelte";
  import { player } from "$lib/player/player.svelte";
  import SaveStatus from "$lib/SaveStatus.svelte";
  import { projectStore } from "$lib/commands/store.svelte";
  import { session } from "$lib/session.svelte";
  import Timeline from "$lib/timeline/Timeline.svelte";
  import TextField from "$lib/editor/TextField.svelte";
  import { deleteItem, duplicateItem, setItemSpan } from "$lib/commands/items";
  import { selection } from "$lib/selection.svelte";

  $effect(() => session.init());

  $effect(() => {
    session.changed(projectStore.revision);
  });

  function isTyping(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLElement &&
      (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
    );
  }

  function duplicateSelected() {
    const item = selection.item;
    if (!item) return;
    const id = crypto.randomUUID();
    projectStore.execute(duplicateItem(item.id, id));
    selection.select(id);
  }

  function onKeydown(e: KeyboardEvent) {
    if (isTyping(e.target)) return;
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      const key = e.key.toLowerCase();
      const action =
        key === "o"
          ? () => session.open()
          : key === "y" || (key === "z" && e.shiftKey)
            ? () => projectStore.redo()
            : key === "z"
              ? () => projectStore.undo()
              : key === "d"
                ? duplicateSelected
                : null;
      if (action) {
        e.preventDefault();
        action();
        return;
      }
    }
    if (!player.video || e.ctrlKey || e.altKey || e.metaKey) return;

    const item = selection.item;
    switch (e.key) {
      case "Delete":
      case "Backspace":
        if (!item) return;
        projectStore.execute(deleteItem(item.id));
        e.preventDefault();
        return;
      case "[":
        if (!item) return;
        projectStore.execute(setItemSpan(item.id, player.time, item.end));
        e.preventDefault();
        return;
      case "]":
        if (!item) return;
        projectStore.execute(setItemSpan(item.id, item.start, player.time));
        e.preventDefault();
        return;
      case "Enter":
        if (!item) return;
        selection.editText();
        e.preventDefault();
        return;
      case "Escape":
        selection.select(null);
        return;
    }

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const next = selection.step(e.key === "ArrowDown" ? 1 : -1);
      if (next) player.seek(next.start);
      e.preventDefault();
      return;
    }

    // Shift+arrow steps one second instead of one frame.
    const stride = e.shiftKey ? Math.round(player.fps) : 1;
    switch (e.key) {
      case " ":
        player.togglePlay();
        break;
      case "ArrowLeft":
        player.step(-stride);
        break;
      case "ArrowRight":
        player.step(stride);
        break;
      case "Home":
        player.seekFrame(0);
        break;
      case "End":
        player.seekFrame(player.lastFrame);
        break;
      default:
        return;
    }
    e.preventDefault();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app">
  <section class="region video" aria-label="Video preview">
    <VideoView />
    <Transport />
  </section>

  <section class="region timeline" aria-label="Timeline">
    <Timeline />
  </section>

  <section class="region text" aria-label="Subtitle text">
    <TextField />
  </section>

  <aside class="region properties" aria-label="Properties">
    <Sidebar />
  </aside>

  <footer class="status">
    <FfmpegStatus />
    <SaveStatus />
  </footer>
</div>

<style>
  :global(:root) {
    --bg: #1b1d21;
    --panel: #24272c;
    --border: #363a41;
    --fg: #d7dae0;
    --muted: #7d8590;
    --ok: #6cc28a;
    --error: #e5756b;
    --warn: #e5c07b;
    --ruler: #2a2d33;
    --track: #232529;
    --lane: #1f2125;
    --item: #355f91;
    --item-selected: #4f86c6;
    --item-text: #e9eff7;
    --grid: rgba(255, 255, 255, 0.05);
    --playhead: #d4d7dc;
    --wave: #6fcf97;
    --wave-bg: #1f3a2c;
    color-scheme: dark;
    font-family: system-ui, sans-serif;
    font-size: 14px;
    color: var(--fg);
    background: var(--bg);
  }

  :global(html, body) {
    margin: 0;
    height: 100%;
    overflow: hidden;
  }

  :global(button) {
    padding: 3px 10px;
    font: inherit;
    color: var(--fg);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 3px;
    cursor: pointer;
  }

  :global(button:hover:not(:disabled)) {
    border-color: var(--muted);
  }

  :global(input:not([type="checkbox"]):not([type="color"]), select) {
    box-sizing: border-box;
    padding: 2px 6px;
    font: inherit;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 3px;
  }

  :global(input:focus, select:focus) {
    outline: none;
    border-color: var(--item-selected);
  }

  :global(input[type="checkbox"]) {
    accent-color: var(--item-selected);
  }

  :global(button:disabled) {
    cursor: default;
    opacity: 0.45;
  }

  .app {
    display: grid;
    grid-template-columns: 1fr 300px;
    grid-template-rows: 1fr 230px 100px auto;
    grid-template-areas:
      "video properties"
      "timeline properties"
      "text properties"
      "status status";
    gap: 1px;
    height: 100vh;
    background: var(--border);
  }

  .region {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    min-height: 0;
    background: var(--panel);
  }

  .video {
    grid-area: video;
    flex-direction: column;
    align-items: stretch;
  }
  .timeline {
    grid-area: timeline;
  }
  .text {
    grid-area: text;
  }
  .properties {
    grid-area: properties;
    align-items: flex-start;
    justify-content: stretch;
  }
  .properties > :global(*) {
    flex: 1;
  }

  .status {
    grid-area: status;
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 4px 10px;
    font-size: 12px;
    color: var(--muted);
    background: var(--bg);
    overflow: hidden;
  }
</style>
