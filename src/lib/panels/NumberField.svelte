<script lang="ts">
  interface Props {
    label: string;
    value: number;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    onchange: (value: number) => void;
  }
  let { label, value, min = 0, max, step = 1, unit = "", onchange }: Props = $props();
  const id = $props.id();

  // Shown rounded; the model keeps full precision (e.g. imported sizes).
  const shown = $derived(Number(value.toFixed(2)));
</script>

<label class="label" for={id}>{label}</label>
<div class="number-field">
  <input
    {id}
    type="number"
    {min}
    {max}
    {step}
    value={shown}
    oninput={(e) => {
      const n = e.currentTarget.valueAsNumber;
      if (Number.isFinite(n) && n >= min && (max === undefined || n <= max)) onchange(n);
    }}
  />
  {#if unit}<span class="unit">{unit}</span>{/if}
</div>

<style>
  .number-field {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  input {
    width: 64px;
  }

  .unit {
    color: var(--muted);
  }
</style>
