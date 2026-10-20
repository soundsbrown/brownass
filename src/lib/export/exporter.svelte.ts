import { Channel, invoke } from "@tauri-apps/api/core";
import { serializeAss } from "$lib/ass/serialize";
import { projectStore } from "$lib/commands/store.svelte";
import { fontsUsed } from "$lib/render/fonts";
import { selection } from "$lib/selection.svelte";
import type { Seconds } from "$lib/time";
import { ffmpegRange, projectForRange, type ExportRange } from "./range";

export type Encoder =
  "x264" | "x265" | "nvencH264" | "nvencHevc" | "qsvH264" | "qsvHevc" | "amfH264" | "amfHevc";
export type Speed = "fast" | "balanced" | "small";

export interface ExportSettings {
  encoder: Encoder;
  /** x264 CRF scale: lower is better quality and larger files. */
  quality: number;
  speed: Speed;
}

export const ENCODER_LABELS: Record<Encoder, string> = {
  x264: "H.264 (x264, software)",
  x265: "H.265 (x265, software)",
  nvencH264: "H.264 (NVIDIA NVENC)",
  nvencHevc: "H.265 (NVIDIA NVENC)",
  qsvH264: "H.264 (Intel Quick Sync)",
  qsvHevc: "H.265 (Intel Quick Sync)",
  amfH264: "H.264 (AMD AMF)",
  amfHevc: "H.265 (AMD AMF)",
};

const SETTINGS_KEY = "brownass.exportSettings";
const DEFAULTS: ExportSettings = { encoder: "x264", quality: 20, speed: "balanced" };

interface Exported {
  path: string;
  audioReencoded: boolean;
}

type Status = "idle" | "exporting" | "done" | "failed";

/** Which part of the video a burn-in export covers. */
export type RangeMode = "whole" | "caption" | "custom";

/** Burn-in and soft-subtitle exports of the open project. */
class Exporter {
  dialogOpen = $state(false);
  encoders = $state<Encoder[] | null>(null);
  settings = $state<ExportSettings>(loadSettings());
  status = $state<Status>("idle");
  /** 0-1 while exporting. */
  progress = $state(0);
  /** Seconds left, estimated from progress so far. */
  remaining = $state<number | null>(null);
  message = $state<string | null>(null);
  /** Object URL of the last rendered test frame. */
  frame = $state<{ url: string; time: Seconds } | null>(null);
  frameBusy = $state(false);
  rangeMode = $state<RangeMode>("whole");
  /** The custom range, in video time. */
  custom = $state<ExportRange>({ start: 0, end: 0 });

  #started = 0;

  /** The range to export, or `null` for the whole video; `undefined` if invalid. */
  get range(): ExportRange | null | undefined {
    const duration = projectStore.project?.video.duration ?? 0;
    const item = selection.item;
    const range =
      this.rangeMode === "whole"
        ? null
        : this.rangeMode === "caption"
          ? item
            ? { start: item.start, end: item.end }
            : undefined
          : this.custom;
    if (range === null) return null;
    if (!range || range.end <= range.start || range.start < 0 || range.end > duration + 1e-6) {
      return undefined;
    }
    return range;
  }

  setCustom(edge: "start" | "end", t: Seconds): void {
    this.custom = { ...this.custom, [edge]: t };
  }

  /** Switches to a custom range, starting from the selected caption or the playhead. */
  useCustomRange(playhead: Seconds): void {
    if (this.rangeMode !== "custom" && this.custom.end <= this.custom.start) {
      const duration = projectStore.project?.video.duration ?? 0;
      const item = selection.item;
      this.custom = item
        ? { start: item.start, end: item.end }
        : { start: playhead, end: Math.min(duration, playhead + 10) };
    }
    this.rangeMode = "custom";
  }

  async detectEncoders(): Promise<void> {
    if (this.encoders) return;
    try {
      this.encoders = await invoke<Encoder[]>("detect_encoders");
    } catch (e) {
      this.encoders = [];
      this.message = String(e);
    }
    if (this.encoders.length && !this.encoders.includes(this.settings.encoder)) {
      this.settings = { ...this.settings, encoder: this.encoders[0] };
    }
  }

  saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // Only a convenience.
    }
  }

  /** Burns the subtitles into a copy of the video (asks where to save it). */
  async exportVideo(): Promise<void> {
    const whole = projectStore.project;
    const range = this.range;
    if (!whole || range === undefined || this.status === "exporting") return;
    this.saveSettings();
    // For a range, ffmpeg seeks to it and the subtitles are shifted to match.
    const ffmpeg = range ? ffmpegRange(range, whole.video.fps) : null;
    const project = range && ffmpeg ? projectForRange(whole, range, ffmpeg.seek) : whole;
    const onProgress = new Channel<number>();
    onProgress.onmessage = (p) => this.#onProgress(p);
    this.#begin();
    try {
      const result = await invoke<Exported | null>("export_video", {
        ass: serializeAss(project),
        fonts: fontsUsed(project),
        settings: { ...this.settings, range: ffmpeg },
        onProgress,
      });
      this.#finish(
        result,
        result?.audioReencoded ? " The audio was re-encoded to AAC to fit the format." : "",
      );
    } catch (e) {
      this.#fail(e);
    }
  }

  /** Writes an MKV with the subtitles as a track and the fonts attached. */
  async exportSoftSubtitles(): Promise<void> {
    const project = projectStore.project;
    if (!project || this.status === "exporting") return;
    this.#begin();
    this.remaining = null;
    try {
      const result = await invoke<Exported | null>("export_soft_subtitles", {
        ass: serializeAss(project),
        fonts: fontsUsed(project),
      });
      this.#finish(result, "");
    } catch (e) {
      this.#fail(e);
    }
  }

  cancel(): Promise<void> {
    return invoke("cancel_export");
  }

  /** Cancels a running export (and waits for it), e.g. before the app closes. */
  async cancelRunning(): Promise<void> {
    if (this.status !== "exporting") return;
    await this.cancel();
    for (let i = 0; i < 50 && this.status === "exporting"; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  reveal(): Promise<void> {
    return invoke("reveal_export");
  }

  /** Renders the frame at `time` exactly as an export would. */
  async renderFrame(time: Seconds): Promise<void> {
    const project = projectStore.project;
    if (!project || this.frameBusy) return;
    this.frameBusy = true;
    try {
      const png = await invoke<ArrayBuffer>("render_test_frame", {
        ass: serializeAss(project),
        fonts: fontsUsed(project),
        time,
      });
      if (this.frame) URL.revokeObjectURL(this.frame.url);
      this.frame = { url: URL.createObjectURL(new Blob([png], { type: "image/png" })), time };
    } catch (e) {
      this.message = String(e);
    } finally {
      this.frameBusy = false;
    }
  }

  #begin() {
    this.status = "exporting";
    this.progress = 0;
    this.remaining = null;
    this.message = null;
    this.#started = performance.now();
  }

  #onProgress(p: number) {
    this.progress = p;
    const elapsed = (performance.now() - this.#started) / 1000;
    // Estimates are noisy at the very start.
    this.remaining = p > 0.02 && elapsed > 2 ? (elapsed / p) * (1 - p) : null;
  }

  #finish(result: Exported | null, note: string) {
    if (!result) {
      this.status = "idle"; // The save dialog was cancelled.
      return;
    }
    this.status = "done";
    this.message = `Saved ${result.path.split(/[\\/]/).pop()}.${note}`;
  }

  #fail(e: unknown) {
    const text = String(e);
    this.status = text === "Cancelled." ? "idle" : "failed";
    this.message = text === "Cancelled." ? "Export cancelled." : text;
  }
}

function loadSettings(): ExportSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export const exporter = new Exporter();
