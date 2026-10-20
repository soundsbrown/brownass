<script lang="ts">
  import TimeField from "$lib/panels/TimeField.svelte";
  import { player } from "$lib/player/player.svelte";
  import { selection } from "$lib/selection.svelte";
  import { formatTime, snapToFrame, type Seconds } from "$lib/time";
  import { ENCODER_LABELS, exporter, type Speed } from "./exporter.svelte";

  interface Props {
    onClose: () => void;
  }
  let { onClose }: Props = $props();

  const busy = $derived(exporter.status === "exporting");
  const speeds: { value: Speed; label: string }[] = [
    { value: "fast", label: "Fast" },
    { value: "balanced", label: "Balanced" },
    { value: "small", label: "Smaller file" },
  ];

  $effect(() => {
    void exporter.detectEncoders();
  });

  /** Keeps a typed range time inside the video. */
  function clampTime(t: Seconds): Seconds {
    return Math.min(Math.max(t, 0), player.duration);
  }

  function close() {
    if (!busy) onClose();
  }

  function minutes(seconds: number): string {
    if (seconds < 60) return `${Math.ceil(seconds)} s`;
    return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
    <header>
      <h2 id="export-title">Export</h2>
      <button class="close" onclick={close} disabled={busy} aria-label="Close">×</button>
    </header>

    <div class="body">
      <section class="settings">
        <label for="export-encoder">Encoder</label>
        {#if exporter.encoders === null}
          <span class="muted">Checking which encoders work…</span>
        {:else if exporter.encoders.length === 0}
          <span class="error">ffmpeg has no supported video encoder.</span>
        {:else}
          <select id="export-encoder" bind:value={exporter.settings.encoder} disabled={busy}>
            {#each exporter.encoders as encoder (encoder)}
              <option value={encoder}>{ENCODER_LABELS[encoder]}</option>
            {/each}
          </select>
        {/if}

        <label for="export-quality">Quality</label>
        <div class="quality">
          <span class="muted">Better</span>
          <input
            id="export-quality"
            type="range"
            min="14"
            max="32"
            bind:value={exporter.settings.quality}
            disabled={busy}
          />
          <span class="muted">Smaller</span>
          <span class="value" title="Constant quality (CRF); 18-23 is typical">
            {exporter.settings.quality}
          </span>
        </div>

        <span class="label">Speed</span>
        <div class="speeds" role="radiogroup" aria-label="Speed">
          {#each speeds as s (s.value)}
            <label class="radio">
              <input
                type="radio"
                bind:group={exporter.settings.speed}
                value={s.value}
                disabled={busy}
              />
              {s.label}
            </label>
          {/each}
        </div>

        <span class="label top">Range</span>
        <div class="range">
          <div class="speeds" role="radiogroup" aria-label="Range">
            <label class="radio">
              <input type="radio" bind:group={exporter.rangeMode} value="whole" disabled={busy} />
              Whole video
            </label>
            <label class="radio" title={selection.item ? "" : "Select a caption first"}>
              <input
                type="radio"
                bind:group={exporter.rangeMode}
                value="caption"
                disabled={busy || !selection.item}
              />
              Selected caption
            </label>
            <label class="radio">
              <input
                type="radio"
                checked={exporter.rangeMode === "custom"}
                disabled={busy}
                onchange={() => exporter.useCustomRange(player.time)}
              />
              Custom
            </label>
          </div>
          {#if exporter.rangeMode === "custom" && player.video}
            {@const fps = player.video.fps}
            <div class="custom">
              <TimeField
                label="From"
                value={exporter.custom.start}
                {fps}
                onchange={(t) => exporter.setCustom("start", clampTime(snapToFrame(t, fps)))}
              />
              <TimeField
                label="To"
                value={exporter.custom.end}
                {fps}
                onchange={(t) => exporter.setCustom("end", clampTime(snapToFrame(t, fps)))}
              />
            </div>
          {/if}
          {#if exporter.range}
            <span class="muted">
              {formatTime(exporter.range.start)} – {formatTime(exporter.range.end)}
              ({(exporter.range.end - exporter.range.start).toFixed(2)} s)
            </span>
          {:else if exporter.range === undefined}
            <span class="error">
              {exporter.rangeMode === "caption"
                ? "No caption is selected."
                : "The end must be after the start."}
            </span>
          {/if}
        </div>
      </section>

      <section class="frame">
        <div class="frame-header">
          <span class="muted">
            {exporter.frame
              ? `Frame at ${formatTime(exporter.frame.time)} as it will be exported`
              : "Check a frame as it will be exported, before rendering the whole video."}
          </span>
          <button
            onclick={() => exporter.renderFrame(player.time)}
            disabled={exporter.frameBusy || !player.video}
          >
            {exporter.frameBusy ? "Rendering…" : "Test frame at playhead"}
          </button>
        </div>
        {#if exporter.frame}
          <img src={exporter.frame.url} alt="Test frame with subtitles burned in" />
        {/if}
      </section>

      {#if busy}
        <section class="progress">
          <progress max="1" value={exporter.progress}></progress>
          <span>
            {Math.round(exporter.progress * 100)}%
            {#if exporter.remaining !== null}· about {minutes(exporter.remaining)} left{/if}
          </span>
          <button onclick={() => exporter.cancel()}>Cancel</button>
        </section>
      {:else if exporter.message}
        <section class="result" class:error={exporter.status === "failed"}>
          <span>{exporter.message}</span>
          {#if exporter.status === "done"}
            <button onclick={() => exporter.reveal()}>Show in folder</button>
          {/if}
        </section>
      {/if}
    </div>

    <footer>
      <button onclick={() => exporter.exportSoftSubtitles()} disabled={busy}>
        Save MKV with soft subtitles (whole video)…
      </button>
      <button
        class="primary"
        onclick={() => exporter.exportVideo()}
        disabled={busy || !exporter.encoders?.length || exporter.range === undefined}
      >
        {exporter.range ? "Export range…" : "Export video…"}
      </button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.55);
  }

  .dialog {
    display: flex;
    flex-direction: column;
    width: min(640px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    font-size: 13px;
  }

  header,
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
  }

  header {
    border-bottom: 1px solid var(--border);
  }

  footer {
    justify-content: flex-end;
    border-top: 1px solid var(--border);
  }

  h2 {
    flex: 1;
    margin: 0;
    font-size: 15px;
  }

  .close {
    padding: 0 8px;
    font-size: 18px;
    background: none;
    border: none;
  }

  .body {
    overflow-y: auto;
  }

  section {
    padding: 12px 14px;
  }

  .settings {
    display: grid;
    grid-template-columns: 80px 1fr;
    align-items: center;
    gap: 10px 12px;
  }

  .settings > label,
  .label {
    color: var(--muted);
  }

  .quality {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .quality input {
    flex: 1;
    accent-color: var(--item-selected);
  }

  .value {
    width: 2em;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .speeds {
    display: flex;
    gap: 14px;
  }

  .top {
    align-self: start;
    padding-top: 1px;
  }

  .range {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .custom {
    display: grid;
    grid-template-columns: auto auto auto auto;
    justify-content: start;
    align-items: center;
    gap: 6px 8px;
  }

  .custom :global(.label) {
    color: var(--muted);
  }

  .radio {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .frame {
    border-top: 1px solid var(--border);
  }

  .frame-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  img {
    display: block;
    width: 100%;
    margin-top: 10px;
    border: 1px solid var(--border);
  }

  .progress,
  .result {
    display: flex;
    align-items: center;
    gap: 10px;
    border-top: 1px solid var(--border);
  }

  progress {
    flex: 1;
    accent-color: var(--item-selected);
  }

  .result span {
    flex: 1;
  }

  .muted {
    color: var(--muted);
  }

  .error {
    color: var(--error);
  }

  .primary {
    background: var(--item-selected);
    border-color: var(--item-selected);
    color: #fff;
  }
</style>
