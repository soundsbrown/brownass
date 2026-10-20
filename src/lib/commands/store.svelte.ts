import type { Project } from "$lib/model/project";
import { History, type Command } from "./history";

/** The open project. All edits go through `execute` so they can be undone. */
class ProjectStore {
  project = $state.raw<Project | null>(null);
  /** Bumped on every change (edit, undo, redo); autosave watches it. */
  revision = $state(0);
  canUndo = $state(false);
  canRedo = $state(false);

  #history = new History();

  /** Replaces the project (e.g. after loading) and clears the history. */
  reset(project: Project | null): void {
    this.project = project;
    this.#history.clear();
    this.#sync(false);
  }

  execute(command: Command): void {
    if (!this.project) return;
    const next = this.#history.execute(this.project, command);
    if (next === this.project) return;
    this.project = next;
    this.#sync(true);
  }

  undo(): void {
    const previous = this.project && this.#history.undo(this.project);
    if (!previous) return;
    this.project = previous;
    this.#sync(true);
  }

  redo(): void {
    const next = this.project && this.#history.redo(this.project);
    if (!next) return;
    this.project = next;
    this.#sync(true);
  }

  #sync(changed: boolean): void {
    if (changed) this.revision++;
    this.canUndo = this.#history.canUndo;
    this.canRedo = this.#history.canRedo;
  }
}

export const projectStore = new ProjectStore();
