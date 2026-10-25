<script lang="ts">
  import { setShapeStyle } from "$lib/commands/items";
  import { projectStore } from "$lib/commands/store.svelte";
  import type { ShapeStyle } from "$lib/model/project";
  import AlignmentGrid from "./AlignmentGrid.svelte";
  import ColorField from "./ColorField.svelte";
  import NumberField from "./NumberField.svelte";

  interface Props {
    name: string;
  }
  let { name }: Props = $props();

  const style = $derived(projectStore.project?.shapeStyles[name]);

  // One undo step per property while it's being dragged or typed.
  function change<K extends keyof ShapeStyle>(key: K, value: ShapeStyle[K]) {
    projectStore.execute(setShapeStyle(name, { [key]: value }, `shapeStyle:${name}:${key}`));
  }
</script>

{#if style}
  <div class="style-editor">
    <h3>Opacity</h3>
    <div class="fields">
      <NumberField
        label="Opacity"
        value={style.opacity}
        max={100}
        unit="%"
        onchange={(v) => change("opacity", v)}
      />
    </div>

    <h3>Outline &amp; shadow</h3>
    <div class="fields">
      <ColorField
        label="Outline"
        color={style.outlineColor}
        onchange={(c) => change("outlineColor", c)}
      />
      <NumberField
        label="Width"
        value={style.outline}
        step={0.5}
        unit="px"
        onchange={(v) => change("outline", v)}
      />
      <ColorField
        label="Shadow"
        color={style.shadowColor}
        onchange={(c) => change("shadowColor", c)}
      />
      <NumberField
        label="Distance"
        value={style.shadow}
        step={0.5}
        unit="px"
        onchange={(v) => change("shadow", v)}
      />
      <NumberField
        label="Blur"
        value={style.blur}
        step={0.25}
        unit="px"
        onchange={(v) => change("blur", v)}
      />
    </div>

    <h3>Position</h3>
    <div class="fields">
      <span class="label">Alignment</span>
      <AlignmentGrid value={style.alignment} onchange={(a) => change("alignment", a)} />
      <NumberField
        label="Left margin"
        value={style.marginL}
        unit="px"
        onchange={(v) => change("marginL", v)}
      />
      <NumberField
        label="Right margin"
        value={style.marginR}
        unit="px"
        onchange={(v) => change("marginR", v)}
      />
      <NumberField
        label="Vertical"
        value={style.marginV}
        unit="px"
        onchange={(v) => change("marginV", v)}
      />
    </div>

    <h3>Fade</h3>
    <div class="fields">
      <NumberField
        label="Fade in"
        value={style.fadeIn}
        step={50}
        unit="ms"
        onchange={(v) => change("fadeIn", v)}
      />
      <NumberField
        label="Fade out"
        value={style.fadeOut}
        step={50}
        unit="ms"
        onchange={(v) => change("fadeOut", v)}
      />
    </div>
  </div>
{/if}

<style>
  h3 {
    margin: 12px 0 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  .fields {
    display: grid;
    grid-template-columns: 82px 1fr;
    align-items: center;
    gap: 5px 8px;
  }

  .fields :global(.label) {
    color: var(--muted);
  }
</style>
