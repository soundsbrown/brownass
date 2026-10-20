<script lang="ts">
  import { player } from "$lib/player/player.svelte";
  import { formatTime } from "$lib/time";

  const fileName = $derived(player.video?.path.split(/[\\/]/).pop() ?? "");
</script>

{#if player.video}
  {@const v = player.video}
  <section class="video-info">
    <dl>
      <dt>File</dt>
      <dd title={v.path}>{fileName}</dd>
      <dt>Size</dt>
      <dd>{v.width} × {v.height}</dd>
      <dt>Frame rate</dt>
      <dd>{Number(v.fps.toFixed(3))} fps</dd>
      <dt>Duration</dt>
      <dd>{formatTime(v.duration)}</dd>
      <dt>Video</dt>
      <dd>{v.videoCodec}</dd>
      <dt>Audio</dt>
      <dd>{v.audioCodec ?? "none"}</dd>
    </dl>
  </section>
{:else}
  <p class="empty">No video loaded</p>
{/if}

<style>
  .video-info {
    padding: 10px 12px;
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0;
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .empty {
    padding: 10px 12px;
    color: var(--muted);
  }
</style>
