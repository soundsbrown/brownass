<script lang="ts">
  import FfmpegStatus from "$lib/ffmpeg/FfmpegStatus.svelte";
</script>

<div class="app">
  <section class="region video" aria-label="Video preview">
    <span class="placeholder">Video preview</span>
  </section>

  <section class="region timeline" aria-label="Timeline">
    <span class="placeholder">Timeline</span>
  </section>

  <section class="region text" aria-label="Subtitle text">
    <span class="placeholder">Text field</span>
  </section>

  <aside class="region properties" aria-label="Properties">
    <span class="placeholder">Properties</span>
  </aside>

  <footer class="status">
    <FfmpegStatus />
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

  .app {
    display: grid;
    grid-template-columns: 1fr 300px;
    grid-template-rows: 1fr 200px 90px auto;
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
    background: #000;
  }
  .timeline {
    grid-area: timeline;
  }
  .text {
    grid-area: text;
  }
  .properties {
    grid-area: properties;
  }

  .placeholder {
    color: var(--muted);
  }

  .status {
    grid-area: status;
    padding: 4px 10px;
    font-size: 12px;
    color: var(--muted);
    background: var(--bg);
    overflow: hidden;
  }
</style>
