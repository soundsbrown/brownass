import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { parseAss } from "$lib/ass/parse";
import { serializeAss } from "$lib/ass/serialize";
import { projectStore } from "$lib/commands/store.svelte";
import { createProject } from "$lib/model/defaults";
import { parseProjectFile, serializeProjectFile } from "$lib/model/file";
import { applyStylesheet, mirrorStyles } from "$lib/model/stylesheet";
import { stylesheets } from "$lib/stylesheets.svelte";
import type { Project, VideoRef } from "$lib/model/project";
import { openVideo, type VideoInfo } from "$lib/player/api";
import { player } from "$lib/player/player.svelte";

/** Wait this long after the last edit before autosaving. */
const AUTOSAVE_DELAY_MS = 800;

type Loaded =
  | { kind: "project"; json: string; path: string; assChanged: boolean }
  | { kind: "ass"; text: string; path: string }
  | { kind: "none" };

interface Saved {
  projectPath: string;
  ass: "written" | "skipped" | "conflict" | "unwritable";
  assBackup: string | null;
}

type SaveStatus = "clean" | "pending" | "saving" | "saved" | "error";

/** What a prompt in the status bar asks the user to decide. */
export type Prompt =
  | { kind: "assConflict"; file: string }
  | { kind: "message"; text: string; tone: "info" | "error"; details?: string[] };

/**
 * Ties the opened video to its project files: loads `foo.bwass` (or starts a
 * new project), autosaves edits, and exports `foo.ass` alongside.
 */
class Session {
  saveStatus = $state<SaveStatus>("clean");
  saveError = $state<string | null>(null);
  /** Where the project was last saved. */
  savedTo = $state<string | null>(null);
  prompt = $state<Prompt | null>(null);

  /** False once the user chose not to (over)write the `.ass` this session. */
  #writeAss = true;
  #overwriteAss = false;
  /** False if loading failed, so a broken project file is never overwritten. */
  #canSave = false;
  #savedRevision = 0;
  /** File name of the video's .ass, for messages. */
  #assName = "";
  /** The project's styles as last mirrored to its stylesheet. */
  #syncedStyles: Project["styles"] | undefined;
  #syncedSheet: string | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #saving: Promise<void> = Promise.resolve();

  /** Shows the open dialog; saves the current project before switching. */
  async open(): Promise<void> {
    let info: VideoInfo | null;
    try {
      info = await openVideo();
    } catch (e) {
      player.error = String(e);
      return;
    }
    if (!info) return;
    await this.flush();
    player.load(info);
    await this.#loadProject(info);
  }

  /** Call after every project change (watches `projectStore.revision`). */
  changed(revision: number): void {
    this.#mirrorStyles();
    if (!this.#canSave || revision === this.#savedRevision) return;
    this.saveStatus = "pending";
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.flush(), AUTOSAVE_DELAY_MS);
  }

  /** Saves now if there are unsaved changes. */
  flush(): Promise<void> {
    clearTimeout(this.#timer);
    // Chain saves so they never overlap or complete out of order.
    this.#saving = this.#saving.then(() => this.#save());
    return this.#saving;
  }

  resolveAssConflict(overwrite: boolean): void {
    this.prompt = null;
    if (overwrite) {
      this.#overwriteAss = true;
    } else {
      this.#writeAss = false;
    }
    // Force a save even without new edits, so the decision takes effect now.
    this.#savedRevision = -1;
    void this.flush();
  }

  /** Saves before the window closes. Returns a cleanup function. */
  init(): () => void {
    const unlisten = getCurrentWindow().onCloseRequested(() => this.flush());
    return () => void unlisten.then((fn) => fn());
  }

  async #loadProject(info: VideoInfo): Promise<void> {
    this.#canSave = false;
    this.#writeAss = true;
    this.#overwriteAss = false;
    this.prompt = null;
    this.saveError = null;
    this.savedTo = null;
    this.#assName = withExtension(baseName(info.path), "ass");

    let project: Project = createProject(videoRef(info));
    let isNew = false;
    try {
      const loaded = await invoke<Loaded>("load_project");
      isNew = loaded.kind === "none";
      switch (loaded.kind) {
        case "project":
          // Keep the project's styles and items, but trust the fresh probe.
          project = { ...parseProjectFile(loaded.json), video: videoRef(info) };
          this.savedTo = loaded.path;
          if (loaded.assChanged) this.prompt = { kind: "assConflict", file: this.#assName };
          break;
        case "ass": {
          const { project: imported, warnings } = parseAss(loaded.text, videoRef(info));
          project = imported;
          const count = imported.items.length;
          this.prompt = {
            kind: "message",
            tone: "info",
            text:
              `Imported ${baseName(loaded.path)}: ${count} subtitle${count === 1 ? "" : "s"}.` +
              (warnings.length
                ? ` ${warnings.length} note${warnings.length === 1 ? "" : "s"} (hover).`
                : ""),
            details: warnings,
          };
          break;
        }
        case "none":
          break;
      }
      this.#canSave = true;
    } catch (e) {
      this.prompt = {
        kind: "message",
        tone: "error",
        text: `${String(e instanceof Error ? e.message : e)} Changes won't be saved, to keep the existing file intact.`,
      };
    }

    const loadedStyles = project.styles;
    project = await this.#link(project, isNew);
    projectStore.reset(project);
    this.#syncedStyles = project.styles;
    this.#syncedSheet = project.stylesheet;
    this.#savedRevision = projectStore.revision;
    this.saveStatus = "clean";
    // The stylesheet changed since this project was saved: re-export now so
    // foo.ass shows the current house style.
    if (this.#canSave && !isNew && !sameStyles(loadedStyles, project.styles)) {
      this.#savedRevision = -1;
      void this.flush();
    }
  }

  /**
   * Links a project to its stylesheet (or the default one, for new, imported
   * and older projects) and refreshes its styles from it.
   */
  async #link(project: Project, isNew: boolean): Promise<Project> {
    await stylesheets.load();
    if (project.stylesheet && !stylesheets.get(project.stylesheet)) {
      this.prompt ??= {
        kind: "message",
        tone: "info",
        text: "This project's stylesheet no longer exists; it keeps the styles saved with it.",
      };
      return { ...project, stylesheet: undefined };
    }
    const sheet = stylesheets.get(project.stylesheet) ?? stylesheets.default;
    if (!sheet) return project;
    const styles = isNew ? { ...sheet.styles } : applyStylesheet(project.styles, sheet);
    return { ...project, stylesheet: sheet.id, styles };
  }

  /** Writes style changes in a linked project back to its stylesheet. */
  #mirrorStyles(): void {
    const project = projectStore.project;
    if (!project || !this.#canSave) return;
    const before = this.#syncedStyles;
    this.#syncedStyles = project.styles;
    // Switching stylesheets isn't an edit of either one.
    if (project.stylesheet !== this.#syncedSheet) {
      this.#syncedSheet = project.stylesheet;
      return;
    }
    const sheet = stylesheets.get(project.stylesheet);
    if (!sheet || !before) return;
    const next = mirrorStyles(sheet, before, project.styles);
    if (next !== sheet) void stylesheets.put(next);
  }

  async #save(): Promise<void> {
    const project = projectStore.project;
    const revision = projectStore.revision;
    if (!project || !this.#canSave || revision === this.#savedRevision) return;

    this.saveStatus = "saving";
    try {
      const saved = await invoke<Saved>("save_project", {
        json: serializeProjectFile(project),
        ass: this.#writeAss ? serializeAss(project) : null,
        overwriteAss: this.#overwriteAss,
      });
      this.#overwriteAss = false;
      this.#savedRevision = revision;
      this.savedTo = saved.projectPath;
      this.saveError = null;
      if (saved.ass === "conflict") {
        this.prompt = { kind: "assConflict", file: this.#assName };
      } else if (saved.assBackup) {
        this.prompt = {
          kind: "message",
          tone: "info",
          text: `The previous ${this.#assName} was kept as ${baseName(saved.assBackup)}.`,
        };
      }
      // Edits made while saving need another save.
      this.saveStatus = projectStore.revision === revision ? "saved" : "pending";
      if (this.saveStatus === "pending") this.changed(projectStore.revision);
    } catch (e) {
      this.saveStatus = "error";
      this.saveError = String(e);
    }
  }
}

function videoRef(info: VideoInfo): VideoRef {
  const { path, width, height, fps, duration } = info;
  return { path, width, height, fps, duration };
}

function sameStyles(a: Project["styles"], b: Project["styles"]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function withExtension(name: string, extension: string): string {
  return `${name.replace(/\.[^.]*$/, "")}.${extension}`;
}

export const session = new Session();
