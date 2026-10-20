<script lang="ts">
  import { session } from "$lib/session.svelte";

  const savedName = $derived(session.savedTo?.split(/[\\/]/).pop());
  const keepFocus = (e: PointerEvent) => e.preventDefault();
</script>

<div class="save-status">
  {#if session.prompt?.kind === "assConflict"}
    <span class="warn">{session.prompt.file} was changed outside BrownASS.</span>
    <button onpointerdown={keepFocus} onclick={() => session.resolveAssConflict(true)}>
      Overwrite it
    </button>
    <button onpointerdown={keepFocus} onclick={() => session.resolveAssConflict(false)}>
      Leave it
    </button>
  {:else if session.prompt?.kind === "message"}
    <span class:error={session.prompt.tone === "error"} title={session.prompt.details?.join("\n")}
      >{session.prompt.text}</span
    >
    <button onpointerdown={keepFocus} onclick={() => (session.prompt = null)} aria-label="Dismiss">
      ×
    </button>
  {/if}

  {#if session.saveStatus === "error"}
    <span class="error" title={session.saveError}>Save failed: {session.saveError}</span>
  {:else if session.saveStatus === "saving" || session.saveStatus === "pending"}
    <span>Saving…</span>
  {:else if session.saveStatus === "saved" && savedName}
    <span title={session.savedTo}>Saved to {savedName}</span>
  {/if}
</div>

<style>
  .save-status {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 0;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .warn {
    color: var(--warn);
  }

  .error {
    color: var(--error);
  }

  button {
    flex: none;
    padding: 1px 8px;
  }
</style>
