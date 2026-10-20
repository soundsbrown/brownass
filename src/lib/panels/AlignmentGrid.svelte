<script lang="ts">
  import type { Alignment } from "$lib/model/project";

  interface Props {
    value: Alignment;
    onchange: (value: Alignment) => void;
  }
  let { value, onchange }: Props = $props();

  // Numpad layout, top row first.
  const rows: Alignment[][] = [
    [7, 8, 9],
    [4, 5, 6],
    [1, 2, 3],
  ];
  const names: Record<Alignment, string> = {
    7: "Top left",
    8: "Top",
    9: "Top right",
    4: "Middle left",
    5: "Centre",
    6: "Middle right",
    1: "Bottom left",
    2: "Bottom",
    3: "Bottom right",
  };
</script>

<div class="grid" role="radiogroup" aria-label="Position on screen">
  {#each rows as row (row[0])}
    {#each row as a (a)}
      <button
        role="radio"
        aria-checked={value === a}
        aria-label={names[a]}
        title={names[a]}
        class:active={value === a}
        onclick={() => onchange(a)}
      ></button>
    {/each}
  {/each}
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 22px);
    grid-auto-rows: 14px;
    gap: 2px;
    padding: 3px;
    width: max-content;
    background: #000;
    border: 1px solid var(--border);
    border-radius: 3px;
  }

  button {
    padding: 0;
    background: var(--panel);
    border: none;
    border-radius: 2px;
  }

  button:hover {
    background: var(--border);
  }

  button.active {
    background: var(--item-selected);
  }
</style>
