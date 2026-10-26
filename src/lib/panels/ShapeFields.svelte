<script lang="ts">
  import type { ShapeGeometry } from "$lib/model/project";
  import { chooseSvg } from "$lib/shapes/svg";
  import NumberField from "./NumberField.svelte";

  interface Props {
    shape: ShapeGeometry;
    /** `field` is set for typed values, so a run of edits can coalesce. */
    onchange: (changes: Partial<ShapeGeometry>, field?: string) => void;
  }
  let { shape, onchange }: Props = $props();

  /** Swaps the SVG for another file, keeping the width. */
  async function replaceSvg() {
    const svg = await chooseSvg();
    if (!svg) return;
    const { name, width: sourceWidth, height: sourceHeight, parts } = svg;
    onchange({ name, sourceWidth, sourceHeight, parts });
  }
</script>

<!-- Cells of the parent's two-column grid. -->
<NumberField
  label="Width"
  value={shape.width}
  min={1}
  unit="px"
  onchange={(v) => onchange({ width: v }, "width")}
/>
<span class="label">Height</span>
<span class="muted"
  >{Number(((shape.width * shape.sourceHeight) / shape.sourceWidth).toFixed(2))} px</span
>
<span class="label">File</span>
<button class="replace" title={shape.name} onclick={replaceSvg}>Replace SVG…</button>

<style>
  .muted {
    color: var(--muted);
  }

  .replace {
    justify-self: start;
  }
</style>
