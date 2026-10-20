<script lang="ts">
  import { projectStore } from "$lib/commands/store.svelte";
  import { player } from "$lib/player/player.svelte";
  import { chronological, selection } from "$lib/selection.svelte";
  import { formatTime } from "$lib/time";
  import { previewText } from "$lib/timeline/tracks";

  const items = $derived(chronological(projectStore.project?.items ?? []));
  let list: HTMLElement;

  // Keep the selected caption visible, however it was selected.
  $effect(() => {
    const id = selection.item?.id;
    if (!id) return;
    list?.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  });

  function choose(id: string, start: number) {
    selection.select(id);
    player.seek(start);
  }

  // Leave focus where it was so the app's keyboard shortcuts keep working.
  const keepFocus = (e: PointerEvent) => e.preventDefault();
</script>

<section class="captions" aria-label="Captions">
  <h2>Captions <span class="count">{items.length}</span></h2>
  <div class="list" bind:this={list} role="listbox" aria-label="Captions in time order">
    {#each items as item, n (item.id)}
      <button
        class="row"
        class:selected={item.id === selection.item?.id}
        data-id={item.id}
        role="option"
        aria-selected={item.id === selection.item?.id}
        onpointerdown={keepFocus}
        onclick={() => choose(item.id, item.start)}
        ondblclick={() => selection.editText()}
      >
        <span class="index">{n + 1}</span>
        <span class="time">{formatTime(item.start, 2)}</span>
        <span class="text">{item.type === "text" ? previewText(item.text) || "(empty)" : ""}</span>
      </button>
    {:else}
      <p class="empty">
        {projectStore.project
          ? "No captions yet. Drag in the timeline to add one."
          : "No video open."}
      </p>
    {/each}
  </div>
</section>

<style>
  .captions {
    display: flex;
    flex-direction: column;
    min-height: 120px;
    flex: 1;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }

  .count {
    margin-left: 4px;
    font-weight: 400;
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg);
  }

  .row {
    display: grid;
    grid-template-columns: 2.5em 6.2em 1fr;
    gap: 6px;
    width: 100%;
    padding: 3px 6px;
    text-align: left;
    background: none;
    border: none;
    border-radius: 0;
    font-variant-numeric: tabular-nums;
  }

  .row:hover {
    background: color-mix(in srgb, var(--border) 50%, transparent);
  }

  .row.selected {
    background: color-mix(in srgb, var(--item-selected) 40%, transparent);
  }

  .index {
    color: var(--muted);
    text-align: right;
  }

  .time {
    color: var(--muted);
  }

  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    margin: 8px;
    color: var(--muted);
  }
</style>
