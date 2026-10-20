<script lang="ts">
  import { untrack } from "svelte";
  import { projectStore } from "$lib/commands/store.svelte";
  import {
    addStyle,
    deleteStyle,
    linkStylesheet,
    renameStyle,
    setItemStyle,
  } from "$lib/commands/styles";
  import { STYLESHEET_VERSION, type Stylesheet } from "$lib/model/stylesheet";
  import { selection } from "$lib/selection.svelte";
  import { stylesheets } from "$lib/stylesheets.svelte";
  import StyleEditor from "./StyleEditor.svelte";
  import VideoInfoPanel from "./VideoInfoPanel.svelte";

  const project = $derived(projectStore.project);
  const styleNames = $derived(Object.keys(project?.styles ?? {}));
  const sheet = $derived(stylesheets.get(project?.stylesheet));
  const caption = $derived(selection.item?.type === "text" ? selection.item : null);

  // Whether the Styles section is expanded; remembered per machine.
  const STYLES_OPEN_KEY = "brownass.stylesOpen";
  let stylesOpen = $state(readStylesOpen());
  $effect(() => {
    try {
      localStorage.setItem(STYLES_OPEN_KEY, String(stylesOpen));
    } catch {
      // Only a convenience.
    }
  });

  function readStylesOpen(): boolean {
    try {
      return localStorage.getItem(STYLES_OPEN_KEY) !== "false";
    } catch {
      return true;
    }
  }

  /** The style shown in the editor. */
  let editing = $state<string | null>(null);
  let renamingStyle = $state<string | null>(null);
  let renamingSheet = $state(false);
  let confirmDeleteSheet = $state(false);

  // Selecting a caption shows its style.
  $effect(() => {
    const styleName = caption?.styleName;
    if (styleName) untrack(() => (editing = styleName));
  });
  const shown = $derived(
    editing && styleNames.includes(editing) ? editing : (styleNames[0] ?? null),
  );

  function uniqueName(base: string, taken: string[]): string {
    if (!taken.includes(base)) return base;
    for (let n = 2; ; n++) if (!taken.includes(`${base} ${n}`)) return `${base} ${n}`;
  }

  function newStyle() {
    if (!project || !shown) return;
    const name = uniqueName("New style", styleNames);
    projectStore.execute(addStyle(name, project.styles[shown]));
    editing = name;
    renamingStyle = name;
  }

  function finishRenameStyle(from: string, to: string) {
    renamingStyle = null;
    const name = to.trim();
    if (!name || name === from) return;
    projectStore.execute(renameStyle(from, name));
    if (project && name in project.styles) editing = name;
  }

  function useStylesheet(id: string) {
    const next = stylesheets.get(id);
    if (!next) return;
    projectStore.execute(linkStylesheet(next, sheet));
    stylesheets.setDefault(id);
  }

  async function newStylesheet() {
    const names = stylesheets.list.map((s) => s.name);
    const created: Stylesheet = {
      version: STYLESHEET_VERSION,
      id: crypto.randomUUID(),
      name: uniqueName(sheet ? `${sheet.name} copy` : "New stylesheet", names),
      styles: { ...(sheet?.styles ?? project?.styles ?? {}) },
    };
    await stylesheets.put(created);
    useStylesheet(created.id);
    renamingSheet = true;
  }

  function finishRenameSheet(name: string) {
    renamingSheet = false;
    const trimmed = name.trim();
    if (sheet && trimmed && trimmed !== sheet.name)
      void stylesheets.put({ ...sheet, name: trimmed });
  }

  async function deleteSheet() {
    confirmDeleteSheet = false;
    if (!sheet) return;
    const other = stylesheets.list.find((s) => s.id !== sheet.id);
    if (!other) return;
    const removed = sheet;
    useStylesheet(other.id);
    await stylesheets.remove(removed.id);
  }

  const keepFocus = (e: PointerEvent) => e.preventDefault();
</script>

<div class="properties">
  {#if project}
    {#if caption}
      <section>
        <h2>Caption</h2>
        <div class="row">
          <label class="label" for="caption-style">Style</label>
          <select
            id="caption-style"
            value={caption.styleName}
            onchange={(e) => projectStore.execute(setItemStyle(caption.id, e.currentTarget.value))}
          >
            {#each styleNames as name (name)}<option value={name}>{name}</option>{/each}
          </select>
        </div>
      </section>
    {/if}

    <section>
      <h2>Stylesheet</h2>
      <div class="row">
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
          <select
            class="grow"
            value={sheet?.id ?? ""}
            aria-label="Stylesheet"
            onchange={(e) => useStylesheet(e.currentTarget.value)}
          >
            {#if !sheet}<option value="">(not linked)</option>{/if}
            {#each stylesheets.list as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
          </select>
        {/if}
      </div>
      <div class="actions">
        <button onpointerdown={keepFocus} onclick={newStylesheet} title="Copy this stylesheet">
          New
        </button>
        <button onpointerdown={keepFocus} disabled={!sheet} onclick={() => (renamingSheet = true)}>
          Rename
        </button>
        {#if confirmDeleteSheet}
          <button class="danger" onclick={deleteSheet}>Delete for all videos</button>
          <button onclick={() => (confirmDeleteSheet = false)}>Cancel</button>
        {:else}
          <button
            onpointerdown={keepFocus}
            disabled={!sheet || stylesheets.list.length < 2}
            onclick={() => (confirmDeleteSheet = true)}>Delete</button
          >
        {/if}
      </div>
    </section>

    <details class="section" bind:open={stylesOpen}>
      <summary><h2>Styles</h2></summary>
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
                onclick={() => (editing = name)}
                ondblclick={() => (renamingStyle = name)}
              >
                <span>{name}</span>
                {#if sheet && !(name in sheet.styles)}
                  <span class="tag" title="Not part of the stylesheet; only this video uses it">
                    this video only
                  </span>
                {/if}
              </button>
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
          title="Captions using it switch to the first remaining style"
          onclick={() => shown && projectStore.execute(deleteStyle(shown))}>Delete</button
        >
      </div>

      {#if shown}
        <StyleEditor name={shown} />
      {/if}
    </details>
  {/if}

  <details class="video" open={!project}>
    <summary>Video</summary>
    <VideoInfoPanel />
  </details>
</div>

<style>
  .properties {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    font-size: 13px;
  }

  section,
  .section {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }

  .section summary {
    display: flex;
    align-items: center;
    gap: 6px;
    list-style: none;
    cursor: pointer;
  }

  .section summary::-webkit-details-marker,
  .video summary::-webkit-details-marker {
    display: none;
  }

  .section summary::before,
  .video summary::before {
    content: "▸";
    margin-bottom: 8px;
    font-size: 10px;
    color: var(--muted);
    transition: transform 0.1s;
  }

  .section[open] summary::before,
  .video[open] summary::before {
    transform: rotate(90deg);
  }

  .section:not([open]) summary h2,
  .section:not([open]) summary::before,
  .video summary::before {
    margin-bottom: 0;
  }

  h2 {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .row .label {
    width: 82px;
    color: var(--muted);
  }

  .grow,
  .row select {
    flex: 1;
    min-width: 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }

  .actions button {
    padding: 1px 8px;
    font-size: 12px;
  }

  .danger {
    color: var(--error);
    border-color: var(--error);
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
    box-sizing: border-box;
  }

  .style {
    display: flex;
    justify-content: space-between;
    gap: 8px;
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

  .tag {
    font-size: 11px;
    color: var(--warn);
  }

  .video {
    padding: 10px 0 0;
  }

  .video summary {
    display: flex;
    align-items: center;
    gap: 6px;
    list-style: none;
    padding: 0 12px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    cursor: pointer;
  }
</style>
