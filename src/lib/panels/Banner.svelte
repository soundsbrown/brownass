<script lang="ts">
  import { getVersion } from "@tauri-apps/api/app";
  import { invoke, isTauri } from "@tauri-apps/api/core";
  import logo from "$lib/assets/logo.png";
  import { stylesheets } from "$lib/stylesheets.svelte";

  let menuOpen = $state(false);
  let version = $state("");
  let menu: HTMLDivElement;

  $effect(() => {
    if (isTauri())
      getVersion().then(
        (v) => (version = v),
        () => {},
      );
  });

  // Close the menu on any click outside it.
  $effect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menu.contains(e.target as Node)) menuOpen = false;
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  });

  function run(action: () => Promise<unknown>) {
    menuOpen = false;
    void action();
  }
</script>

<div class="banner">
  <img src={logo} alt="" width="56" height="56" />
  <span class="name">BrownASS</span>
  <div class="menu" bind:this={menu}>
    <button
      class="menu-button"
      aria-label="Menu"
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onclick={() => (menuOpen = !menuOpen)}>⋮</button
    >
    {#if menuOpen}
      <div class="items" role="menu">
        <button role="menuitem" onclick={() => run(() => stylesheets.openFolder())}>
          Open stylesheets folder
        </button>
        <button role="menuitem" onclick={() => run(() => invoke("open_log_folder"))}>
          Open log folder
        </button>
        {#if version}<div class="version">BrownASS {version}</div>{/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .banner {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 8px 12px 14px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    user-select: none;
  }

  img {
    flex: none;
    border-radius: 12px;
  }

  .name {
    flex: 1;
    font-size: 26px;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--fg);
  }

  .menu {
    position: relative;
    align-self: flex-start;
  }

  .menu-button {
    padding: 2px 8px;
    font-size: 18px;
    line-height: 1;
    color: var(--muted);
    background: none;
    border: none;
  }

  .menu-button:hover {
    color: var(--fg);
  }

  .items {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    min-width: 200px;
    padding: 4px 0;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 4px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  }

  .items button {
    padding: 6px 12px;
    text-align: left;
    background: none;
    border: none;
    border-radius: 0;
  }

  .items button:hover {
    background: color-mix(in srgb, var(--item-selected) 35%, transparent);
  }

  .version {
    margin-top: 4px;
    padding: 6px 12px 2px;
    font-size: 12px;
    color: var(--muted);
    border-top: 1px solid var(--border);
  }
</style>
