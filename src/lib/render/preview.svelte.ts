import JASSUB from "jassub";
import { fontFiles, missingFonts } from "./fonts";

/** Used until the project's own track is ready; JASSUB needs some content. */
const EMPTY_TRACK = "[Script Info]\nScriptType: v4.00+\n\n[Events]\n";

/**
 * JASSUB with fonts from the system font index (the same fonts export uses),
 * loaded the first time libass asks for a name.
 */
class AppJassub extends JASSUB {
  onFontsAdded?: () => void;
  #requested = new Map<string, Promise<void>>();

  /**
   * Adds every face of a font family (libass only asks by name and weight,
   * not style, so it chooses among them, as it does at export), then asks for
   * a repaint, since rendering may have fallen back meanwhile.
   */
  loadFont(name: string): Promise<void> {
    const key = name.trim().toLowerCase();
    let loading = this.#requested.get(key);
    if (!loading) {
      loading = (async () => {
        const files = await fontFiles(name);
        if (files.length === 0) return;
        await this.ready;
        // Resolves once the worker has added them, so the repaint sees them.
        await this.renderer.addFonts(files);
        this.onFontsAdded?.();
      })().catch((e) => console.warn(`Could not load font ${name}:`, e));
      this.#requested.set(key, loading);
    }
    return loading;
  }

  // Called by the worker when libass needs a font it doesn't have. Fonts are
  // added by loadFont() rather than returned, so all faces arrive together.
  override async _getLocalFont(font: string): Promise<undefined> {
    void this.loadFont(font);
    return undefined;
  }
}

/** Renders the project's subtitles over the video with libass (JASSUB). */
class Preview {
  error = $state<string | null>(null);
  /** Fonts the project uses that aren't installed. */
  missingFonts = $state<string[]>([]);

  #instance: AppJassub | null = null;
  #track = EMPTY_TRACK;
  #frame = 0;
  #fontsChecked = "";
  /** Installed fonts the project uses, preloaded into each new instance. */
  #installedFonts: string[] = [];

  /** Overlays the preview on `video`; returns a cleanup function. */
  attach(video: HTMLVideoElement): () => void {
    let instance: AppJassub;
    try {
      instance = new AppJassub({ video, subContent: this.#track, queryFonts: "local" });
    } catch (e) {
      this.error = `Subtitle preview unavailable: ${String(e)}`;
      return () => {};
    }
    instance.onFontsAdded = () => this.#repaint();
    for (const name of this.#installedFonts) void instance.loadFont(name);
    instance.ready.then(
      () => this.#apply(),
      (e) => (this.error = `Subtitle preview unavailable: ${String(e)}`),
    );
    this.#instance = instance;
    return () => {
      if (this.#instance === instance) this.#instance = null;
      void instance.destroy();
    };
  }

  /** Shows a new version of the subtitles; rapid updates coalesce per frame. */
  setTrack(ass: string): void {
    this.#track = ass;
    cancelAnimationFrame(this.#frame);
    this.#frame = requestAnimationFrame(() => void this.#apply());
  }

  /**
   * Takes the font names a project uses: preloads the installed ones (so the
   * first render already uses them) and lists the rest in `missingFonts`.
   */
  async useFonts(names: string[]): Promise<void> {
    const key = names.join("\n").toLowerCase();
    if (key === this.#fontsChecked) return;
    this.#fontsChecked = key;
    let missing: string[];
    try {
      missing = await missingFonts(names);
    } catch {
      // Not knowing which fonts are missing only loses the warning; libass
      // still asks for fonts as it needs them.
      return;
    }
    if (key !== this.#fontsChecked) return;
    this.missingFonts = missing;
    const lower = new Set(missing.map((m) => m.toLowerCase()));
    this.#installedFonts = names.filter((n) => !lower.has(n.toLowerCase()));
    for (const name of this.#installedFonts) void this.#instance?.loadFont(name);
  }

  async #apply(): Promise<void> {
    const instance = this.#instance;
    if (!instance) return;
    await instance.ready;
    await instance.renderer.setTrack(this.#track);
    this.#repaint();
  }

  // While paused no new frames arrive, so redraw the current one explicitly.
  #repaint(): void {
    const instance = this.#instance;
    if (instance?._lastDemandTime) void instance.manualRender(instance._lastDemandTime, true);
  }
}

export const preview = new Preview();
