<script lang="ts">
  import { serializeAss } from "$lib/ass/serialize";
  import { projectStore } from "$lib/commands/store.svelte";
  import { fontsUsed } from "$lib/render/fonts";
  import { preview } from "$lib/render/preview.svelte";
  import { recents } from "$lib/recents.svelte";
  import { session } from "$lib/session.svelte";
  import RecentList from "./RecentList.svelte";
  import { player } from "./player.svelte";

  // The preview renders exactly what gets exported.
  $effect(() => {
    const project = projectStore.project;
    if (!project) return;
    preview.setTrack(serializeAss(project));
    void preview.useFonts(fontsUsed(project));
  });

  function attachVideo(el: HTMLVideoElement) {
    const detachPlayer = player.attach(el);
    const detachPreview = preview.attach(el);
    return () => {
      detachPreview();
      detachPlayer();
    };
  }
</script>

<div class="video-view">
  {#if player.src}
    <!-- Subtitles are drawn by the preview overlay, not a caption track. -->
    <!-- svelte-ignore a11y_media_has_caption -->
    <video src={player.src} preload="auto" {@attach attachVideo}></video>
  {:else}
    <div class="empty">
      <button onclick={() => session.open()}>Open video…</button>
      <span class="shortcut">Ctrl+O</span>
      {#if recents.list.length > 0}
        <div class="recents">
          <h3>Recent videos</h3>
          <RecentList />
        </div>
      {/if}
    </div>
  {/if}

  {#if player.video && preview.missingFonts.length > 0}
    <div class="notice" title="The preview and export use a fallback font instead.">
      Missing font{preview.missingFonts.length > 1 ? "s" : ""}: {preview.missingFonts.join(", ")}
    </div>
  {/if}

  {#if player.error || preview.error}
    <div class="error" role="alert">
      <span>{player.error ?? preview.error}</span>
      <button
        onclick={() => (player.error ? (player.error = null) : (preview.error = null))}
        aria-label="Dismiss">×</button
      >
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

  .recents {
    width: min(420px, 80vw);
    margin-top: 18px;
    padding: 8px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  .recents h3 {
    margin: 2px 10px 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  .shortcut {
    font-size: 12px;
    color: var(--muted);
  }

  .notice {
    position: absolute;
    top: 8px;
    left: 8px;
    max-width: calc(100% - 16px);
    padding: 3px 8px;
    font-size: 12px;
    color: var(--warn);
    background: rgba(0, 0, 0, 0.7);
    border: 1px solid color-mix(in srgb, var(--warn) 50%, transparent);
    border-radius: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
