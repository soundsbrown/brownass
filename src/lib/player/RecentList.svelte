<script lang="ts">
  import { recents } from "$lib/recents.svelte";
  import { session } from "$lib/session.svelte";

  interface Props {
    /** Called after a video was chosen (e.g. to close a menu). */
    onChoose?: () => void;
  }
  let { onChoose }: Props = $props();

  const split = (path: string) => {
    const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
    return { name: path.slice(i + 1), folder: path.slice(0, Math.max(i, 0)) };
  };
</script>

<ul class="recent">
  {#each recents.list as recent (recent.path)}
    {@const { name, folder } = split(recent.path)}
    <li class:missing={!recent.exists}>
      <button
        class="open"
        disabled={!recent.exists}
        title={recent.exists ? recent.path : `${recent.path} (not found)`}
        onclick={() => {
          onChoose?.();
          void session.openRecent(recent.path);
        }}
      >
        <span class="name">{name}</span>
        <span class="folder">{recent.exists ? folder : "not found"}</span>
      </button>
      <button
        class="forget"
        title="Remove from this list"
        aria-label="Remove {name} from recent videos"
        onclick={() => recents.forget(recent.path)}>×</button
      >
    </li>
  {/each}
</ul>

<style>
  .recent {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
  }

  .open {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    padding: 5px 10px;
    text-align: left;
    background: none;
    border: none;
    border-radius: 3px;
  }

  .open:hover:not(:disabled) {
    background: color-mix(in srgb, var(--item-selected) 30%, transparent);
  }

  .name,
  .folder {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .folder {
    font-size: 11px;
    color: var(--muted);
  }

  .missing .name {
    text-decoration: line-through;
  }

  .forget {
    padding: 0 8px;
    color: var(--muted);
    background: none;
    border: none;
    visibility: hidden;
  }

  li:hover .forget,
  .forget:focus-visible {
    visibility: visible;
  }
</style>
