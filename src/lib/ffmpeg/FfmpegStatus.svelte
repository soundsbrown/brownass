<script lang="ts">
  import { onMount } from "svelte";
  import { isTauri } from "@tauri-apps/api/core";
  import {
    ffmpegStatus,
    locateFfmpeg,
    toFfmpegError,
    type FfmpegError,
    type FfmpegInfo,
  } from "./api";

  let info = $state<FfmpegInfo | null>(null);
  let error = $state<FfmpegError | null>(null);
  let busy = $state(false);

  async function check(action: () => Promise<FfmpegInfo | null>) {
    busy = true;
    try {
      const result = await action();
      if (result) {
        info = result;
        error = null;
      }
    } catch (e) {
      error = toFfmpegError(e);
      info = null;
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    if (isTauri()) check(ffmpegStatus);
  });
</script>

<div class="ffmpeg-status">
  {#if !isTauri()}
    <span>Not running inside Tauri</span>
  {:else if info}
    <span class="ok" title={`${info.ffmpegPath}\n${info.ffprobePath}`}>{info.version}</span>
  {:else if error}
    <span class="error">{error.message}</span>
    {#if error.kind !== "failed"}
      <span class="hint">Install it with <code>winget install Gyan.FFmpeg</code>, or</span>
    {/if}
    <button disabled={busy} onclick={() => check(locateFfmpeg)}>Locate ffmpeg…</button>
    <button disabled={busy} onclick={() => check(ffmpegStatus)}>Check again</button>
  {:else}
    <span>Checking ffmpeg…</span>
  {/if}
</div>

<style>
  .ffmpeg-status {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ok {
    color: var(--ok);
  }

  .error {
    color: var(--error);
  }

  code {
    color: var(--fg);
  }

  button {
    flex: none;
    padding: 1px 8px;
    font: inherit;
    color: var(--fg);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 3px;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    border-color: var(--muted);
  }

  button:disabled {
    cursor: default;
    opacity: 0.6;
  }
</style>
