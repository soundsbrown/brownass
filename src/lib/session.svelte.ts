import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { importCaptions } from "$lib/ass/importCaptions";
import { serializeAss } from "$lib/ass/serialize";
import { projectStore } from "$lib/commands/store.svelte";
import { createProject } from "$lib/model/defaults";
import { parseProjectFile, serializeProjectFile } from "$lib/model/file";
import { conformToStylesheet, firstStyle } from "$lib/model/stylesheet";
import { stylesheets } from "$lib/stylesheets.svelte";
import { exporter } from "$lib/export/exporter.svelte";
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
    // Pick up stylesheets added to (or changed in) the folder meanwhile.
    await stylesheets.refresh();
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

  /**
   * Before the window closes: stops a running export (so no partial file is
   * left) and saves. Returns a cleanup function.
   */
  init(): () => void {
    const unlisten = getCurrentWindow().onCloseRequested(async () => {
      await exporter.cancelRunning();
      await this.flush();
    });
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
    let fromFile = false;
    let imported: { file: string; notes: string[] } | null = null;
    try {
      const loaded = await invoke<Loaded>("load_project");
      switch (loaded.kind) {
        case "project":
          // Keep the project's styles and items, but trust the fresh probe.
          project = { ...parseProjectFile(loaded.json), video: videoRef(info) };
          fromFile = true;
          this.savedTo = loaded.path;
          if (loaded.assChanged) this.prompt = { kind: "assConflict", file: this.#assName };
          break;
        case "ass": {
          // Only timing and text: the captions take the stylesheet's styles.
          await stylesheets.load();
          const sheet = stylesheets.default;
          const result = importCaptions(loaded.text, videoRef(info), firstStyle(sheet));
          project = { ...project, stylesheet: sheet.id, items: result.items };
          imported = { file: baseName(loaded.path), notes: result.notes };
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

    const before = project;
    const linked = await this.#link(project);
    project = linked.project;

    if (imported) {
      const notes = [...imported.notes, ...linked.notes];
      const count = project.items.length;
      this.prompt = {
        kind: "message",
        tone: "info",
        text:
          `Imported ${imported.file}: ${count} subtitle${count === 1 ? "" : "s"}.` +
          (notes.length ? ` ${notes.length} note${notes.length === 1 ? "" : "s"} (hover).` : ""),
        details: notes,
      };
    } else if (linked.notes.length > 0) {
      this.prompt ??= { kind: "message", tone: "info", text: linked.notes.join(" ") };
    }

    projectStore.reset(project);
    this.#syncedStyles = project.styles;
    this.#syncedSheet = project.stylesheet;
    this.#savedRevision = projectStore.revision;
    this.saveStatus = "clean";
    // The stylesheet changed since this project was saved (or captions had to
    // be reassigned): save now so foo.ass shows the current house style.
    if (this.#canSave && fromFile && !sameContent(before, project)) {
      this.#savedRevision = -1;
      void this.flush();
    }
  }

  /**
   * Links a project to its stylesheet (or the default one, for new, imported
   * and older projects, or if its stylesheet was deleted) and gives it exactly
   * that stylesheet's styles. Returns notes for the user.
   */
  async #link(project: Project): Promise<{ project: Project; notes: string[] }> {
    await stylesheets.load();
    const notes: string[] = [];
    let sheet = stylesheets.get(project.stylesheet);
    if (!sheet) {
      sheet = stylesheets.default;
      if (!sheet) return { project, notes };
      if (project.stylesheet) {
        notes.push(`This project's stylesheet no longer exists, so it now uses "${sheet.name}".`);
      }
    }
    const { project: linked, reassigned } = conformToStylesheet(project, sheet);
    if (reassigned > 0) {
      notes.push(
        `${reassigned} caption${reassigned === 1 ? "" : "s"} used a style "${sheet.name}" doesn't have, and now use${reassigned === 1 ? "s" : ""} "${firstStyle(sheet)}".`,
      );
    }
    return { project: linked, notes };
  }

  /** A linked project's styles are its stylesheet's: write changes back. */
  #mirrorStyles(): void {
    const project = projectStore.project;
    if (!project || !this.#canSave) return;
    const sheet = stylesheets.get(project.stylesheet);
    // Switching stylesheets isn't an edit of either one.
    const sameSheet = project.stylesheet === this.#syncedSheet;
    if (sheet && sameSheet && project.styles !== this.#syncedStyles) {
      void stylesheets.put({ ...sheet, styles: project.styles });
    }
    this.#syncedStyles = project.styles;
    this.#syncedSheet = project.stylesheet;
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

function sameContent(a: Project, b: Project): boolean {
  return JSON.stringify([a.styles, a.items]) === JSON.stringify([b.styles, b.items]);
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function withExtension(name: string, extension: string): string {
  return `${name.replace(/\.[^.]*$/, "")}.${extension}`;
}

export const session = new Session();
