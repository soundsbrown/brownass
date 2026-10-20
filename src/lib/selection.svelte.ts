import { projectStore } from "$lib/commands/store.svelte";
import type { Item } from "$lib/model/project";

/** The selected item. UI state only: not part of the project or its history. */
class Selection {
  id = $state<string | null>(null);
  /** Bumped to ask the text field to take focus. */
  focusRequest = $state(0);

  /** The selected item, or `null` if none (or it was deleted or undone). */
  get item(): Item | null {
    const id = this.id;
    return (id && projectStore.project?.items.find((i) => i.id === id)) || null;
  }

  select(id: string | null): void {
    this.id = id;
  }

  /** Focuses the text field on the selected item. */
  editText(): void {
    if (this.item) this.focusRequest++;
  }
}

export const selection = new Selection();
