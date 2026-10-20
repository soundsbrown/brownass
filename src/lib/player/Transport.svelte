<script lang="ts">
  import { formatTime } from "$lib/time";
  import { exporter } from "$lib/export/exporter.svelte";
  import { session } from "$lib/session.svelte";
  import { player } from "./player.svelte";

  // Keep focus where it was (usually the document) so keyboard shortcuts such
  // as Space keep working after clicking a button.
  const keepFocus = (e: PointerEvent) => e.preventDefault();
  const disabled = $derived(!player.video);
</script>

<div class="transport">
  <div class="file">
    <button onpointerdown={keepFocus} onclick={() => session.open()}>Open video…</button>
    <button
      onpointerdown={keepFocus}
      onclick={() => (exporter.dialogOpen = true)}
      {disabled}
      title="Export (Ctrl+E)">Export…</button
    >
  </div>

  <div class="buttons">
    <button
      class="icon"
      onpointerdown={keepFocus}
      onclick={() => player.seekFrame(0)}
      {disabled}
      title="Go to start (Home)"
      aria-label="Go to start"
    >
      <svg viewBox="0 0 16 16"><path d="M3 3h2v10H3zM13 3v10L6 8z" /></svg>
    </button>
    <button
      class="icon"
      onpointerdown={keepFocus}
      onclick={() => player.step(-1)}
      {disabled}
      title="Previous frame (←)"
      aria-label="Previous frame"
    >
      <svg viewBox="0 0 16 16"><path d="M11 3v10L4 8zM12 3h1.5v10H12z" /></svg>
    </button>
    <button
      class="icon play"
      onpointerdown={keepFocus}
      onclick={() => player.togglePlay()}
      {disabled}
      title={player.playing ? "Pause (Space)" : "Play (Space)"}
      aria-label={player.playing ? "Pause" : "Play"}
    >
      {#if player.playing}
        <svg viewBox="0 0 16 16"><path d="M4 3h3v10H4zM9 3h3v10H9z" /></svg>
      {:else}
        <svg viewBox="0 0 16 16"><path d="M4 2.5v11L13 8z" /></svg>
      {/if}
    </button>
    <button
      class="icon"
      onpointerdown={keepFocus}
      onclick={() => player.step(1)}
      {disabled}
      title="Next frame (→)"
      aria-label="Next frame"
    >
      <svg viewBox="0 0 16 16"><path d="M5 3v10l7-5zM2.5 3H4v10H2.5z" /></svg>
    </button>
    <button
      class="icon"
      onpointerdown={keepFocus}
      onclick={() => player.seekFrame(player.lastFrame)}
      {disabled}
      title="Go to end (End)"
      aria-label="Go to end"
    >
      <svg viewBox="0 0 16 16"><path d="M11 3h2v10h-2zM3 3v10l7-5z" /></svg>
    </button>
  </div>

  {#if player.video}
    <div class="readout">
      <span class="time">{formatTime(player.time)}</span>
      <span class="muted">/ {formatTime(player.duration)}</span>
      <span class="muted frame">frame {player.frame} / {player.lastFrame}</span>
    </div>
  {/if}
</div>

<style>
  .transport {
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 6px 10px;
    background: var(--panel);
    border-top: 1px solid var(--border);
  }

  .file {
    display: flex;
    gap: 4px;
  }

  .buttons {
    display: flex;
    gap: 2px;
  }

  .icon {
    display: grid;
    place-items: center;
    width: 30px;
    height: 26px;
    padding: 0;
  }

  .icon svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
  }

  .play {
    width: 38px;
  }

  .readout {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-variant-numeric: tabular-nums;
  }

  .time {
    font-size: 15px;
  }

  .muted {
    color: var(--muted);
  }

  .frame {
    margin-left: 10px;
  }
</style>
