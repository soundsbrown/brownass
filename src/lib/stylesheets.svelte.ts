import { invoke } from "@tauri-apps/api/core";
import {
  houseStyle,
  parseStylesheet,
  serializeStylesheet,
  type Stylesheet,
} from "$lib/model/stylesheet";

/** Which stylesheet new projects use; a per-machine convenience. */
const DEFAULT_KEY = "brownass.defaultStylesheet";

interface Stored {
  id: string;
  json: string;
}

/** The app's stylesheets, stored by the backend in the app data folder. */
class Stylesheets {
  list = $state.raw<Stylesheet[]>([]);
  /** Stylesheet files that couldn't be read or saved. */
  errors = $state<string[]>([]);

  #loading: Promise<void> | null = null;
  #saving: Promise<void> = Promise.resolve();

  /** Loads the stylesheets once, creating the house style on first run. */
  load(): Promise<void> {
    this.#loading ??= this.#load();
    return this.#loading;
  }

  get(id: string | undefined): Stylesheet | undefined {
    return id === undefined ? undefined : this.list.find((s) => s.id === id);
  }

  /** The stylesheet new projects link to. */
  get default(): Stylesheet {
    let preferred: string | null = null;
    try {
      preferred = localStorage.getItem(DEFAULT_KEY);
    } catch {
      // Storage unavailable: fall back to the first stylesheet.
    }
    return this.get(preferred ?? undefined) ?? this.list[0];
  }

  setDefault(id: string): void {
    try {
      localStorage.setItem(DEFAULT_KEY, id);
    } catch {
      // Only a convenience.
    }
  }

  /** Adds or replaces a stylesheet and saves it. */
  put(sheet: Stylesheet): Promise<void> {
    const index = this.list.findIndex((s) => s.id === sheet.id);
    this.list = index < 0 ? [...this.list, sheet] : this.list.with(index, sheet);
    // Chain saves so an older version never lands after a newer one.
    this.#saving = this.#saving.then(() =>
      invoke("save_stylesheet", { id: sheet.id, json: serializeStylesheet(sheet) }).then(
        () => undefined,
        (e) => void (this.errors = [...this.errors, String(e)]),
      ),
    );
    return this.#saving;
  }

  async remove(id: string): Promise<void> {
    if (this.list.length < 2) return;
    this.list = this.list.filter((s) => s.id !== id);
    await invoke("delete_stylesheet", { id });
  }

  async #load(): Promise<void> {
    let stored: Stored[] = [];
    try {
      stored = await invoke<Stored[]>("list_stylesheets");
    } catch (e) {
      this.errors = [String(e)];
    }
    const sheets: Stylesheet[] = [];
    for (const { id, json } of stored) {
      try {
        sheets.push(parseStylesheet(json));
      } catch (e) {
        this.errors = [...this.errors, `Stylesheet ${id}: ${(e as Error).message}`];
      }
    }
    this.list = sheets.sort((a, b) => a.name.localeCompare(b.name));
    if (this.list.length === 0) await this.put(houseStyle(crypto.randomUUID()));
  }
}

export const stylesheets = new Stylesheets();
