import type { Project } from "$lib/model/project";

/**
 * An edit to the project. `apply` must not mutate its input; returning the
 * same object means "nothing changed" and adds no undo step.
 */
export interface Command {
  label: string;
  apply(project: Project): Project;
  /**
   * Consecutive commands with the same key, each within `mergeWindowMs`
   * (default MERGE_WINDOW_MS) of the previous one, form a single undo step.
   */
  mergeKey?: string;
  mergeWindowMs?: number;
}

export const MERGE_WINDOW_MS = 1000;

let gestureCount = 0;

/** A unique merge key for one drag gesture. */
export function newGestureKey(): string {
  return `gesture:${++gestureCount}`;
}

/**
 * Marks a command as part of a drag gesture: everything with the same key
 * forms one undo step, however long the user pauses mid-drag.
 */
export function inGesture(command: Command, key: string): Command {
  return { ...command, mergeKey: key, mergeWindowMs: Infinity };
}

interface Entry {
  label: string;
  /** The project before this step (undo) or after it (redo). */
  project: Project;
  mergeKey?: string;
  time: number;
}

/** Undo/redo stacks of project snapshots. Snapshots share unchanged data. */
export class History {
  #undo: Entry[] = [];
  #redo: Entry[] = [];

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  get undoLabel(): string | undefined {
    return this.#undo.at(-1)?.label;
  }

  get redoLabel(): string | undefined {
    return this.#redo.at(-1)?.label;
  }

  /** Applies `command` to `current` and records it; returns the new project. */
  execute(current: Project, command: Command, now = Date.now()): Project {
    const next = command.apply(current);
    if (next === current) return current;

    const top = this.#undo.at(-1);
    const merges =
      command.mergeKey !== undefined &&
      top?.mergeKey === command.mergeKey &&
      now - top.time < (command.mergeWindowMs ?? MERGE_WINDOW_MS);
    if (merges) {
      top.time = now;
    } else {
      this.#undo.push({
        label: command.label,
        project: current,
        mergeKey: command.mergeKey,
        time: now,
      });
    }
    this.#redo = [];
    return next;
  }

  /** Returns the project before the last step, or `null` if there is none. */
  undo(current: Project): Project | null {
    const entry = this.#undo.pop();
    if (!entry) return null;
    this.#redo.push({ label: entry.label, project: current, time: 0 });
    return entry.project;
  }

  redo(current: Project): Project | null {
    const entry = this.#redo.pop();
    if (!entry) return null;
    // Never merge into a redone step.
    this.#undo.push({ label: entry.label, project: current, time: 0 });
    return entry.project;
  }

  clear(): void {
    this.#undo = [];
    this.#redo = [];
  }
}
