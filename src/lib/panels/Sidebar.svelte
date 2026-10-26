<script lang="ts">
  import { projectStore } from "$lib/commands/store.svelte";
  import { setItemLayer, setItemSpan, setShapeGeometry } from "$lib/commands/items";
  import { setHideOverlays } from "$lib/commands/overlays";
  import { linkStylesheet, setItemStyle } from "$lib/commands/styles";
  import {
    anyReassigned,
    describeReassigned,
    itemsWithoutStyle,
    type Reassigned,
    type Stylesheet,
  } from "$lib/model/stylesheet";
  import { selection } from "$lib/selection.svelte";
  import { stylesheets } from "$lib/stylesheets.svelte";
  import { snapToFrame } from "$lib/time";
  import CaptionList from "./CaptionList.svelte";
  import NumberField from "./NumberField.svelte";
  import ShapeFields from "./ShapeFields.svelte";
  import StylesView from "./StylesView.svelte";
  import TimeField from "./TimeField.svelte";
  import VideoInfoPanel from "./VideoInfoPanel.svelte";

  const project = $derived(projectStore.project);
  const sheet = $derived(stylesheets.get(project?.stylesheet));
  const item = $derived(selection.item);
  /** The styles the selected item can use: text styles or shape styles. */
  const styleNames = $derived(
    Object.keys((item?.type === "shape" ? project?.shapeStyles : project?.styles) ?? {}),
  );

  let editingStyles = $state(false);
  /** A stylesheet switch waiting for confirmation, and how many items it reassigns. */
  let pendingSwitch = $state<{ sheet: Stylesheet; affected: Reassigned } | null>(null);

  function requestSwitch(select: HTMLSelectElement) {
    const next = stylesheets.get(select.value);
    // Show the current stylesheet until the switch actually happens.
    select.value = sheet?.id ?? "";
    if (!next || !project || next.id === sheet?.id) return;
    const affected = itemsWithoutStyle(project, next);
    if (!anyReassigned(affected)) switchTo(next);
    else pendingSwitch = { sheet: next, affected };
  }

  /** Each typed time is an undo step; a run of ↑/↓ nudges on one field is one. */
  function setTimes(id: string, field: string, start: number, end: number, nudge: boolean) {
    projectStore.execute(setItemSpan(id, start, end, nudge ? `nudge:${id}:${field}` : undefined));
  }

  function switchTo(next: Stylesheet) {
    pendingSwitch = null;
    projectStore.execute(linkStylesheet(next));
    stylesheets.setDefault(next.id);
  }
</script>

{#if editingStyles && project}
  <StylesView onDone={() => (editingStyles = false)} {switchTo} />
{:else}
  <div class="sidebar">
    <CaptionList />

    <section>
      <h2>Properties</h2>
      {#if item && project}
        {@const fps = project.video.fps}
        <div class="props">
          <TimeField
            label="Start"
            value={item.start}
            {fps}
            onchange={(t, nudge) =>
              setTimes(item.id, "start", snapToFrame(t, fps), item.end, nudge)}
          />
          <TimeField
            label="End"
            value={item.end}
            {fps}
            onchange={(t, nudge) =>
              setTimes(item.id, "end", item.start, snapToFrame(t, fps), nudge)}
          />
          <TimeField
            label="Duration"
            value={item.end - item.start}
            {fps}
            onchange={(d, nudge) =>
              setTimes(
                item.id,
                "duration",
                item.start,
                item.start + Math.max(1 / fps, snapToFrame(d, fps)),
                nudge,
              )}
          />
          <label class="label" for="item-style">Style</label>
          <select
            id="item-style"
            value={item.styleName}
            onchange={(e) => projectStore.execute(setItemStyle(item.id, e.currentTarget.value))}
          >
            {#each styleNames as name (name)}<option value={name}>{name}</option>{/each}
          </select>
          {#if item.type === "shape"}
            <NumberField
              label="Layer"
              value={item.layer}
              onchange={(v) => projectStore.execute(setItemLayer(item.id, v))}
            />
            <ShapeFields
              shape={item.shape}
              onchange={(changes, field) =>
                projectStore.execute(
                  setShapeGeometry(item.id, changes, field && `shape:${item.id}:${field}`),
                )}
            />
          {/if}
        </div>
      {:else}
        <p class="muted">Nothing selected</p>
      {/if}
    </section>

    <details class="section">
      <summary><h2>Video</h2></summary>
      <VideoInfoPanel />
    </details>

    <section>
      <h2>Stylesheet</h2>
      {#if project}
        <div class="row">
          <select
            class="grow"
            value={sheet?.id ?? ""}
            aria-label="Stylesheet"
            onchange={(e) => requestSwitch(e.currentTarget)}
          >
            {#each stylesheets.list as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
          </select>
          <button onclick={() => (editingStyles = true)} disabled={!sheet}>Edit styles…</button>
        </div>
        {#if project.overlays.length > 0}
          <label class="check" title="The stylesheet's overlays, in this video only">
            <input
              type="checkbox"
              checked={!project.hideOverlays}
              onchange={(e) => projectStore.execute(setHideOverlays(!e.currentTarget.checked))}
            />
            <span class="overlays">Show {project.overlays.map((o) => o.shape.name).join(", ")}</span
            >
          </label>
        {/if}
        {#if pendingSwitch}
          <div class="confirm" role="alert">
            <p>
              Some items use styles "{pendingSwitch.sheet.name}" doesn't have: {describeReassigned(
                pendingSwitch.affected,
                pendingSwitch.sheet,
                "will",
              )}.
            </p>
            <div class="actions">
              <button class="danger" onclick={() => pendingSwitch && switchTo(pendingSwitch.sheet)}>
                Switch
              </button>
              <button onclick={() => (pendingSwitch = null)}>Cancel</button>
            </div>
          </div>
        {/if}
      {:else}
        <p class="muted">Open a video to choose its stylesheet.</p>
      {/if}
    </section>
  </div>
{/if}

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-size: 13px;
  }

  section,
  .section {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }

  .sidebar :global(h2) {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  .section summary {
    display: flex;
    align-items: center;
    gap: 6px;
    list-style: none;
    cursor: pointer;
  }

  .section summary::-webkit-details-marker {
    display: none;
  }

  .section summary::before {
    content: "▸";
    font-size: 10px;
    color: var(--muted);
    transition: transform 0.1s;
  }

  .section[open] summary::before {
    transform: rotate(90deg);
  }

  .section summary :global(h2) {
    margin: 0;
  }

  .section[open] summary {
    margin-bottom: 8px;
  }

  .section :global(.video-info) {
    padding: 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .props {
    display: grid;
    grid-template-columns: 70px 1fr;
    align-items: center;
    gap: 6px 8px;
  }

  .props :global(.label) {
    color: var(--muted);
  }

  .props select {
    min-width: 0;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
  }

  .overlays {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row select {
    flex: 1;
    min-width: 0;
  }

  .muted {
    margin: 0;
    color: var(--muted);
  }

  .confirm {
    margin-top: 8px;
    padding: 6px 8px;
    border: 1px solid var(--warn);
    border-radius: 3px;
  }

  .confirm p {
    margin: 0 0 6px;
  }

  .actions {
    display: flex;
    gap: 4px;
  }

  .danger {
    color: var(--warn);
    border-color: var(--warn);
  }
</style>
