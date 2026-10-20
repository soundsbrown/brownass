import { projectStore } from "$lib/commands/store.svelte";
import type { Item } from "$lib/model/project";

/** Items in the order the user sees them: by start time, then layer. */
export function chronological(items: readonly Item[]): Item[] {
  return items.toSorted((a, b) => a.start - b.start || a.layer - b.layer || a.end - b.end);
}

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

  /**
   * Selects the next (`+1`) or previous (`-1`) item in time order; with
   * nothing selected, the first or last. Returns the newly selected item.
   */
  step(direction: 1 | -1): Item | null {
    const items = chronological(projectStore.project?.items ?? []);
    if (items.length === 0) return null;
    const index = items.findIndex((i) => i.id === this.id);
    const next =
      index < 0
        ? items[direction > 0 ? 0 : items.length - 1]
        : items[Math.min(Math.max(index + direction, 0), items.length - 1)];
    this.id = next.id;
    return next;
  }

  /** Focuses the text field on the selected item. */
  editText(): void {
    if (this.item) this.focusRequest++;
  }
}

export const selection = new Selection();
