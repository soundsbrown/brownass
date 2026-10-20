import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { serializeAss } from "$lib/ass/serialize";
import { projectStore } from "$lib/commands/store.svelte";
import { createProject } from "$lib/model/defaults";
import { parseProjectFile, serializeProjectFile } from "$lib/model/file";
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
}

type SaveStatus = "clean" | "pending" | "saving" | "saved" | "error";

/** What a prompt in the status bar asks the user to decide. */
export type Prompt =
  { kind: "assConflict"; file: string } | { kind: "message"; text: string; tone: "info" | "error" };

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
    try {
      const loaded = await invoke<Loaded>("load_project");
      switch (loaded.kind) {
        case "project":
          // Keep the project's styles and items, but trust the fresh probe.
          project = { ...parseProjectFile(loaded.json), video: videoRef(info) };
          this.savedTo = loaded.path;
          if (loaded.assChanged) this.prompt = { kind: "assConflict", file: this.#assName };
          break;
        case "ass":
          // Importing comes next; until then, leave the user's file alone.
          this.#writeAss = false;
          this.prompt = {
            kind: "message",
            tone: "info",
            text: `${baseName(loaded.path)} exists but can't be imported yet, so it won't be overwritten.`,
          };
          break;
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
    projectStore.reset(project);
    this.#savedRevision = projectStore.revision;
    this.saveStatus = "clean";
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

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function withExtension(name: string, extension: string): string {
  return `${name.replace(/\.[^.]*$/, "")}.${extension}`;
}

export const session = new Session();
