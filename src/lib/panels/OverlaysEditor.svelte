<script lang="ts">
  import {
    addOverlay,
    deleteOverlay,
    setOverlayGeometry,
    setOverlayStyle,
  } from "$lib/commands/overlays";
  import { projectStore } from "$lib/commands/store.svelte";
  import { chooseSvg, svgGeometry } from "$lib/shapes/svg";
  import ShapeFields from "./ShapeFields.svelte";

  interface Props {
    /** Shows a shape style in the shape styles tab. */
    oneditstyle: (name: string) => void;
  }
  let { oneditstyle }: Props = $props();

  const project = $derived(projectStore.project);
  const overlays = $derived(project?.overlays ?? []);
  const shapeStyles = $derived(Object.keys(project?.shapeStyles ?? {}));

  let editing = $state<string | null>(null);
  const shown = $derived(overlays.find((o) => o.id === editing) ?? overlays[0]);

  async function add() {
    const svg = await chooseSvg();
    if (!svg || shapeStyles.length === 0) return;
    const id = crypto.randomUUID();
    projectStore.execute(addOverlay({ id, styleName: shapeStyles[0], shape: svgGeometry(svg) }));
    editing = id;
  }

  const keepFocus = (e: PointerEvent) => e.preventDefault();
</script>

{#if overlays.length > 0}
  <ul class="overlay-list">
    {#each overlays as overlay (overlay.id)}
      <li>
        <button
          class="overlay"
          class:active={overlay.id === shown?.id}
          onpointerdown={keepFocus}
          onclick={() => (editing = overlay.id)}>{overlay.shape.name}</button
        >
      </li>
    {/each}
  </ul>
{:else}
  <p class="muted">
    SVGs added here, such as a logo, show on every video using this stylesheet, for the whole video
    and below all captions and shapes.
  </p>
{/if}
<div class="actions">
  <button onpointerdown={keepFocus} onclick={add}>Add SVG…</button>
  <button
    onpointerdown={keepFocus}
    disabled={!shown}
    onclick={() => shown && projectStore.execute(deleteOverlay(shown.id))}>Delete</button
  >
</div>

{#if shown}
  {@const id = shown.id}
  <div class="fields">
    <label class="label" for="overlay-style">Style</label>
    <div class="row">
      <select
        id="overlay-style"
        value={shown.styleName}
        onchange={(e) => projectStore.execute(setOverlayStyle(id, e.currentTarget.value))}
      >
        {#each shapeStyles as name (name)}<option value={name}>{name}</option>{/each}
      </select>
      <button onpointerdown={keepFocus} onclick={() => oneditstyle(shown.styleName)}>Edit</button>
    </div>
    <ShapeFields
      shape={shown.shape}
      onchange={(changes, field) =>
        projectStore.execute(setOverlayGeometry(id, changes, field && `overlay:${id}:${field}`))}
    />
  </div>
{/if}

<style>
  .overlay-list {
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: 3px;
    max-height: 160px;
    overflow-y: auto;
  }

  .overlay {
    display: block;
    width: 100%;
    padding: 4px 8px;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: none;
    border: none;
    border-radius: 0;
  }

  .overlay.active {
    background: color-mix(in srgb, var(--item-selected) 35%, transparent);
  }

  .muted {
    margin: 0;
    color: var(--muted);
  }

  .actions {
    display: flex;
    gap: 4px;
    margin-top: 6px;
  }

  .actions button {
    padding: 1px 8px;
    font-size: 12px;
  }

  .fields {
    display: grid;
    grid-template-columns: 82px minmax(0, 1fr);
    align-items: center;
    gap: 5px 8px;
    margin-top: 12px;
  }

  .fields :global(.label) {
    color: var(--muted);
  }

  .row {
    display: flex;
    gap: 4px;
    min-width: 0;
  }

  .row select {
    flex: 1;
    min-width: 0;
  }
</style>
