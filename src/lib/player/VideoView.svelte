<script lang="ts">
  import { player } from "./player.svelte";
</script>

<div class="video-view">
  {#if player.src}
    <!-- Subtitles are rendered on top of this later; there is no caption track. -->
    <!-- svelte-ignore a11y_media_has_caption -->
    <video src={player.src} preload="auto" {@attach (el) => player.attach(el)}></video>
  {:else}
    <div class="empty">
      <button onclick={() => player.open()}>Open video…</button>
      <span class="shortcut">Ctrl+O</span>
    </div>
  {/if}

  {#if player.error}
    <div class="error" role="alert">
      <span>{player.error}</span>
      <button onclick={() => (player.error = null)} aria-label="Dismiss">×</button>
    </div>
  {/if}
</div>

<style>
  .video-view {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    flex: 1;
    background: #000;
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }

  .shortcut {
    font-size: 12px;
    color: var(--muted);
  }

  .error {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    color: var(--fg);
    background: color-mix(in srgb, var(--error) 25%, var(--panel));
    border: 1px solid var(--error);
    border-radius: 4px;
  }

  .error span {
    flex: 1;
  }

  .error button {
    padding: 0 6px;
    background: none;
    border: none;
    font-size: 16px;
  }
</style>
