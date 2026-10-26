<script lang="ts">
  import { untrack } from "svelte";
  import { projectStore } from "$lib/commands/store.svelte";
  import { addStyle, deleteStyle, renameStyle, type StyleKind } from "$lib/commands/styles";
  import {
    STYLESHEET_VERSION,
    anyReassigned,
    describeReassigned,
    itemsWithoutStyle,
    uniqueStyleName,
    type Stylesheet,
  } from "$lib/model/stylesheet";
  import { selection } from "$lib/selection.svelte";
  import { stylesheets } from "$lib/stylesheets.svelte";
  import { allStyleNames, styleColor } from "$lib/timeline/styleColors";
  import OverlaysEditor from "./OverlaysEditor.svelte";
  import ShapeStyleEditor from "./ShapeStyleEditor.svelte";
  import StyleEditor from "./StyleEditor.svelte";

  interface Props {
    onDone: () => void;
    /** Switches the project to another stylesheet (already confirmed). */
    switchTo: (sheet: Stylesheet) => void;
  }
  let { onDone, switchTo }: Props = $props();

  const project = $derived(projectStore.project);
  const sheet = $derived(stylesheets.get(project?.stylesheet));
  const selected = $derived(selection.item);

  /** Which tab is shown: text styles (captions), shape styles or overlays. */
  let tab = $state<StyleKind | "overlays">(
    untrack(() => (selected?.type === "shape" ? "shape" : "text")),
  );
  const kind = $derived<StyleKind>(tab === "text" ? "text" : "shape");
  const styleNames = $derived(
    Object.keys((kind === "text" ? project?.styles : project?.shapeStyles) ?? {}),
  );
  const colorNames = $derived(project ? allStyleNames(project) : []);

  /** The style shown in the editor, per list. */
  let editing = $state<Record<StyleKind, string | null>>(
    untrack(() => ({
      text: selected?.type === "text" ? selected.styleName : null,
      shape: selected?.type === "shape" ? selected.styleName : null,
    })),
  );
  let renamingStyle = $state<string | null>(null);
  let renamingSheet = $state(false);
  let confirmDelete = $state(false);

  // Selecting a caption or shape shows its style.
  $effect(() => {
    const item = selected;
    if (!item) return;
    untrack(() => {
      tab = item.type === "shape" ? "shape" : "text";
      editing[tab] = item.styleName;
    });
  });
  const shown = $derived.by(() => {
    const name = editing[kind];
    return name && styleNames.includes(name) ? name : (styleNames[0] ?? null);
  });

  /** Where this video goes if its stylesheet is deleted. */
  const replacement = $derived(stylesheets.list.find((s) => s.id !== sheet?.id));

  function newStyle() {
    if (!project || !shown) return;
    // Names are unique across text and shape styles.
    const name = uniqueStyleName(kind === "text" ? "New style" : "New shape style", colorNames);
    projectStore.execute(
      kind === "text"
        ? addStyle(name, project.styles[shown])
        : addStyle(name, project.shapeStyles[shown], "shape"),
    );
    editing[kind] = name;
    renamingStyle = name;
  }

  function finishRenameStyle(from: string, to: string) {
    renamingStyle = null;
    const name = to.trim();
    if (!name || name === from) return;
    projectStore.execute(renameStyle(from, name, kind));
    if (styleNames.includes(name)) editing[kind] = name;
  }

  async function copyStylesheet() {
    if (!sheet) return;
    const created: Stylesheet = {
      version: STYLESHEET_VERSION,
      id: crypto.randomUUID(),
      name: uniqueStyleName(
        `${sheet.name} copy`,
        stylesheets.list.map((s) => s.name),
      ),
      styles: { ...sheet.styles },
      shapeStyles: { ...sheet.shapeStyles },
      overlays: [...sheet.overlays],
    };
    await stylesheets.put(created);
    // Same styles, so no caption changes.
    switchTo(created);
    renamingSheet = true;
  }

  function finishRenameSheet(name: string) {
    renamingSheet = false;
    const trimmed = name.trim();
    if (sheet && trimmed && trimmed !== sheet.name) {
      void stylesheets.put({ ...sheet, name: trimmed });
    }
  }

  async function deleteStylesheet() {
    confirmDelete = false;
    if (!sheet || !replacement) return;
    const removed = sheet;
    switchTo(replacement);
    await stylesheets.remove(removed.id);
  }

  const tabs = [
    { id: "text", label: "Text styles" },
    { id: "shape", label: "Shape styles" },
    { id: "overlays", label: "Overlays" },
  ] as const;

  const keepFocus = (e: PointerEvent) => e.preventDefault();
</script>

<div class="styles-view">
  <header>
    {#if renamingSheet && sheet}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="grow"
        value={sheet.name}
        autofocus
        aria-label="Stylesheet name"
        onblur={(e) => finishRenameSheet(e.currentTarget.value)}
        onkeydown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") renamingSheet = false;
        }}
      />
    {:else}
      <h2 class="grow" title="Changes apply to every video using this stylesheet">
        {sheet?.name ?? "Styles"}
      </h2>
    {/if}
    <button class="done" onclick={onDone}>Done</button>
  </header>

  <section>
    <div class="actions">
      <button
        onpointerdown={keepFocus}
        onclick={copyStylesheet}
        title="Copy this stylesheet and use the copy"
      >
        Copy
      </button>
      <button onpointerdown={keepFocus} onclick={() => (renamingSheet = true)}>Rename</button>
      <button
        onpointerdown={keepFocus}
        disabled={!replacement}
        title={replacement ? "" : "The last stylesheet can't be deleted"}
        onclick={() => (confirmDelete = true)}>Delete</button
      >
      <button
        class="folder"
        onpointerdown={keepFocus}
        title="Documents\BrownASS\Stylesheets: copy .bwstyle files here to share stylesheets"
        onclick={() => void stylesheets.openFolder()}>Open folder</button
      >
    </div>
    {#if confirmDelete && sheet && replacement && project}
      {@const affected = itemsWithoutStyle(project, replacement)}
      <div class="confirm" role="alert">
        <p>
          Delete "{sheet.name}" for all videos? This video switches to "{replacement.name}"{#if anyReassigned(affected)},
            and {describeReassigned(affected, replacement, "will")}{/if}. Other videos switch when
          next opened.
        </p>
        <div class="actions">
          <button class="danger" onclick={deleteStylesheet}>Delete</button>
          <button onclick={() => (confirmDelete = false)}>Cancel</button>
        </div>
      </div>
    {/if}
  </section>

  <section class="styles">
    <div class="tabs" role="tablist">
      {#each tabs as t (t.id)}
        <button
          role="tab"
          aria-selected={tab === t.id}
          class:active={tab === t.id}
          onpointerdown={keepFocus}
          onclick={() => (tab = t.id)}>{t.label}</button
        >
      {/each}
    </div>
    {#if tab === "overlays"}
      <OverlaysEditor
        oneditstyle={(name) => {
          tab = "shape";
          editing.shape = name;
        }}
      />
    {:else}
      <ul class="style-list">
        {#each styleNames as name (name)}
          <li>
            {#if renamingStyle === name}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                value={name}
                autofocus
                aria-label="Style name"
                onblur={(e) => finishRenameStyle(name, e.currentTarget.value)}
                onkeydown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") renamingStyle = null;
                }}
              />
            {:else}
              <button
                class="style"
                class:active={name === shown}
                onpointerdown={keepFocus}
                onclick={() => (editing[kind] = name)}
                ondblclick={() => (renamingStyle = name)}
                ><span class="swatch" style:background={styleColor(colorNames, name).fill}
                ></span>{name}</button
              >
            {/if}
          </li>
        {/each}
      </ul>
      <div class="actions">
        <button onpointerdown={keepFocus} onclick={newStyle} title="Copy the selected style"
          >New</button
        >
        <button onpointerdown={keepFocus} disabled={!shown} onclick={() => (renamingStyle = shown)}>
          Rename
        </button>
        <button
          onpointerdown={keepFocus}
          disabled={!shown || styleNames.length < 2}
          title={kind === "text"
            ? "Captions using it switch to the first remaining style"
            : "Shapes and overlays using it switch to the first remaining shape style"}
          onclick={() => shown && projectStore.execute(deleteStyle(shown, undefined, kind))}
          >Delete</button
        >
      </div>

      {#if shown && kind === "text"}
        <StyleEditor name={shown} />
      {:else if shown}
        <ShapeStyleEditor name={shown} />
      {/if}
    {/if}
  </section>
</div>

<style>
  .styles-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    font-size: 13px;
  }

  header {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }

  header h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .grow {
    flex: 1;
    min-width: 0;
  }

  .done {
    border-color: var(--item-selected);
  }

  section {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }

  .tabs {
    display: flex;
    gap: 2px;
    margin-bottom: 8px;
  }

  .tabs button {
    flex: 1;
    padding: 2px 8px;
    font-size: 12px;
    color: var(--muted);
  }

  .tabs button.active {
    color: inherit;
    border-color: var(--item-selected);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .styles .actions {
    margin-top: 6px;
  }

  .actions button {
    padding: 1px 8px;
    font-size: 12px;
  }

  .folder {
    margin-left: auto;
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

  .danger {
    color: var(--warn);
    border-color: var(--warn);
  }

  .style-list {
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: 3px;
    max-height: 160px;
    overflow-y: auto;
  }

  .style-list input {
    width: 100%;
  }

  .swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 8px;
    border-radius: 2px;
    vertical-align: -1px;
  }

  .style {
    display: block;
    width: 100%;
    padding: 4px 8px;
    text-align: left;
    background: none;
    border: none;
    border-radius: 0;
  }

  .style.active {
    background: color-mix(in srgb, var(--item-selected) 35%, transparent);
  }
</style>
