<script lang="ts">
  import { tick, untrack } from "svelte";
  import { editText } from "$lib/commands/items";
  import { projectStore } from "$lib/commands/store.svelte";
  import { selection } from "$lib/selection.svelte";
  import { formatTime } from "$lib/time";
  import { wrapInTag, type FormatTag } from "./format";

  let field: HTMLTextAreaElement;

  const item = $derived(selection.item?.type === "text" ? selection.item : null);
  /** Position in time order, as shown to the user. */
  const index = $derived.by(() => {
    if (!item) return 0;
    const items = projectStore.project?.items ?? [];
    return (
      1 +
      items.filter((i) => i.start < item.start || (i.start === item.start && i.id < item.id)).length
    );
  });

  $effect(() => {
    if (selection.focusRequest > 0) {
      untrack(() => {
        field.focus();
        field.select();
      });
    }
  });

  function onInput() {
    if (item) projectStore.execute(editText(item.id, field.value));
  }

  async function format(tag: FormatTag) {
    if (!item) return;
    const edit = wrapInTag(field.value, field.selectionStart, field.selectionEnd, tag);
    projectStore.execute(editText(item.id, edit.text));
    await tick();
    field.focus();
    field.setSelectionRange(edit.selectionStart, edit.selectionEnd);
  }

  const buttons: { tag: FormatTag; label: string; title: string }[] = [
    { tag: "b", label: "B", title: "Bold (Ctrl+B)" },
    { tag: "i", label: "I", title: "Italic (Ctrl+I)" },
    { tag: "u", label: "U", title: "Underline (Ctrl+U)" },
  ];
  // Keep focus and the selection in the text field when clicking a button.
  const keepFocus = (e: PointerEvent) => e.preventDefault();

  // Enter finishes editing (back to the timeline's shortcuts); Shift+Enter
  // inserts a line break. Undo goes through the project history, so typing
  // stays one undo step and matches what the timeline shows.
  function onKeydown(e: KeyboardEvent) {
    const key = e.key.toLowerCase();
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      field.blur();
    } else if (e.key === "Escape") {
      field.blur();
    } else if (e.ctrlKey && (key === "y" || (key === "z" && e.shiftKey))) {
      e.preventDefault();
      projectStore.redo();
    } else if (e.ctrlKey && key === "z") {
      e.preventDefault();
      projectStore.undo();
    } else if (e.ctrlKey && !e.shiftKey && (key === "b" || key === "i" || key === "u")) {
      e.preventDefault();
      void format(key);
    }
  }
</script>

<div class="text-field">
  <div class="header">
    {#if item}
      <span>#{index}</span>
      <span class="times">
        {formatTime(item.start)} → {formatTime(item.end)}
        <span class="muted">({(item.end - item.start).toFixed(3)} s)</span>
      </span>
      <span class="hint">Enter to finish, Shift+Enter for a new line</span>
      <span class="format">
        {#each buttons as b (b.tag)}
          <button
            class="format-{b.tag}"
            title={b.title}
            aria-label={b.title}
            onpointerdown={keepFocus}
            onclick={() => format(b.tag)}>{b.label}</button
          >
        {/each}
      </span>
    {:else if selection.item?.type === "shape"}
      <span class="muted">Shapes have no text</span>
    {:else}
      <span class="muted">Drag in the timeline to create a subtitle, or click one to edit it</span>
    {/if}
  </div>
  <textarea
    bind:this={field}
    value={item?.text ?? ""}
    disabled={!item}
    spellcheck="true"
    aria-label="Subtitle text"
    oninput={onInput}
    onkeydown={onKeydown}></textarea>
</div>

<style>
  .text-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    height: 100%;
    padding: 6px 10px 8px;
    box-sizing: border-box;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 20px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .hint {
    margin-left: auto;
    color: var(--muted);
  }

  .muted {
    color: var(--muted);
  }

  .format {
    display: flex;
    gap: 2px;
  }

  .format button {
    width: 24px;
    padding: 0;
    font-size: 12px;
  }

  .format-b {
    font-weight: 700;
  }

  .format-i {
    font-style: italic;
  }

  .format-u {
    text-decoration: underline;
  }

  textarea {
    flex: 1;
    resize: none;
    padding: 6px 8px;
    font: inherit;
    font-size: 15px;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 3px;
  }

  textarea:focus {
    outline: none;
    border-color: var(--item-selected);
  }

  textarea:disabled {
    opacity: 0.5;
  }
</style>
