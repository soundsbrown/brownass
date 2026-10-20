<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { setStyle } from "$lib/commands/items";
  import { projectStore } from "$lib/commands/store.svelte";
  import type { AssStyle } from "$lib/model/project";
  import AlignmentGrid from "./AlignmentGrid.svelte";
  import ColorField from "./ColorField.svelte";
  import NumberField from "./NumberField.svelte";

  interface Props {
    name: string;
  }
  let { name }: Props = $props();
  const fontListId = $props.id();

  const style = $derived(projectStore.project?.styles[name]);

  let families = $state<string[]>([]);
  $effect(() => {
    invoke<string[]>("font_families").then(
      (list) => (families = list),
      () => (families = []),
    );
  });

  // One undo step per property while it's being dragged or typed.
  function change<K extends keyof AssStyle>(key: K, value: AssStyle[K]) {
    projectStore.execute(setStyle(name, { [key]: value }, `style:${name}:${key}`));
  }

  const toggles: { key: "bold" | "italic" | "underline"; label: string; title: string }[] = [
    { key: "bold", label: "B", title: "Bold" },
    { key: "italic", label: "I", title: "Italic" },
    { key: "underline", label: "U", title: "Underline" },
  ];
</script>

{#if style}
  <div class="style-editor">
    <h3>Text</h3>
    <div class="fields">
      <label class="label" for="{fontListId}-font">Font</label>
      <input
        id="{fontListId}-font"
        list={fontListId}
        value={style.fontName}
        spellcheck="false"
        onchange={(e) => {
          const font = e.currentTarget.value.trim();
          if (font) change("fontName", font);
        }}
      />
      <datalist id={fontListId}>
        {#each families as family (family)}<option value={family}></option>{/each}
      </datalist>

      <NumberField
        label="Size"
        value={style.fontSize}
        min={1}
        unit="px"
        onchange={(v) => change("fontSize", v)}
      />

      <span class="label">Style</span>
      <div class="toggles">
        {#each toggles as t (t.key)}
          <button
            class="toggle {t.key}"
            class:active={style[t.key]}
            aria-pressed={style[t.key]}
            title={t.title}
            onclick={() => change(t.key, !style[t.key])}>{t.label}</button
          >
        {/each}
      </div>

      <ColorField
        label="Colour"
        color={style.primaryColor}
        onchange={(c) => change("primaryColor", c)}
      />
    </div>

    <h3>Outline &amp; shadow</h3>
    <div class="fields">
      <span class="label">Background</span>
      <label class="check">
        <input
          type="checkbox"
          checked={style.borderStyle === 3}
          onchange={(e) => change("borderStyle", e.currentTarget.checked ? 3 : 1)}
        />
        Opaque box
      </label>
      <ColorField
        label={style.borderStyle === 3 ? "Box colour" : "Outline"}
        color={style.outlineColor}
        onchange={(c) => change("outlineColor", c)}
      />
      <NumberField
        label={style.borderStyle === 3 ? "Box padding" : "Width"}
        value={style.outline}
        step={0.5}
        unit="px"
        onchange={(v) => change("outline", v)}
      />
      <ColorField label="Shadow" color={style.backColor} onchange={(c) => change("backColor", c)} />
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

  .toggles {
    display: flex;
    gap: 2px;
  }

  .toggle {
    width: 28px;
    padding: 2px 0;
  }

  .toggle.bold {
    font-weight: 700;
  }

  .toggle.italic {
    font-style: italic;
  }

  .toggle.underline {
    text-decoration: underline;
  }

  .toggle.active {
    background: var(--item-selected);
    border-color: var(--item-selected);
  }

  .check {
    display: flex;
    align-items: center;
    gap: 6px;
  }
</style>
