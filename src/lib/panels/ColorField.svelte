<script lang="ts">
  import type { Color } from "$lib/model/project";
  import { fromHex, fromPercent, toHex, toPercent } from "./color";

  interface Props {
    label: string;
    color: Color;
    onchange: (color: Color) => void;
  }
  let { label, color, onchange }: Props = $props();
  const id = $props.id();
</script>

<label class="label" for={id}>{label}</label>
<div class="color-field">
  <input
    {id}
    type="color"
    value={toHex(color)}
    oninput={(e) => {
      const next = fromHex(e.currentTarget.value, color.a);
      if (next) onchange(next);
    }}
  />
  <input
    class="opacity"
    type="number"
    min="0"
    max="100"
    step="5"
    value={toPercent(color.a)}
    aria-label="{label} opacity"
    title="Opacity"
    oninput={(e) => {
      const p = e.currentTarget.valueAsNumber;
      if (Number.isFinite(p)) onchange({ ...color, a: fromPercent(p) });
    }}
  />
  <span class="unit">%</span>
</div>

<style>
  .color-field {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  input[type="color"] {
    width: 34px;
    height: 22px;
    padding: 0 2px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 3px;
  }

  .opacity {
    width: 58px;
  }

  .unit {
    color: var(--muted);
  }
</style>
