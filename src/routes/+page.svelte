<script lang="ts">
  import FfmpegStatus from "$lib/ffmpeg/FfmpegStatus.svelte";
  import VideoInfoPanel from "$lib/panels/VideoInfoPanel.svelte";
  import Transport from "$lib/player/Transport.svelte";
  import VideoView from "$lib/player/VideoView.svelte";
  import { player } from "$lib/player/player.svelte";
  import SaveStatus from "$lib/SaveStatus.svelte";
  import { projectStore } from "$lib/commands/store.svelte";
  import { session } from "$lib/session.svelte";
  import Timeline from "$lib/timeline/Timeline.svelte";

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
              : null;
      if (action) {
        e.preventDefault();
        action();
        return;
      }
    }
    if (!player.video || e.ctrlKey || e.altKey || e.metaKey) return;

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
    <span class="placeholder">Text field</span>
  </section>

  <aside class="region properties" aria-label="Properties">
    <VideoInfoPanel />
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
    --lane: #1f2125;
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

  :global(button:disabled) {
    cursor: default;
    opacity: 0.45;
  }

  .app {
    display: grid;
    grid-template-columns: 1fr 300px;
    grid-template-rows: 1fr 180px 90px auto;
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

  .placeholder {
    color: var(--muted);
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
