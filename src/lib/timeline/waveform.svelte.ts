import { Channel, invoke } from "@tauri-apps/api/core";
import type { VideoInfo } from "$lib/player/api";
import { decodeWaveform, type Waveform } from "./waveform";

type Status = "none" | "loading" | "ready" | "error";

/** Loads waveform peaks for the opened video. */
class WaveformLoader {
  status = $state<Status>("none");
  /** Extraction progress, 0-1. */
  progress = $state(0);
  data = $state.raw<Waveform | null>(null);
  error = $state<string | null>(null);

  #request = 0;

  async load(video: VideoInfo | null): Promise<void> {
    const request = ++this.#request;
    const current = () => request === this.#request;
    this.data = null;
    this.error = null;
    this.progress = 0;
    if (!video?.audioCodec) {
      this.status = "none";
      return;
    }

    this.status = "loading";
    const onProgress = new Channel<number>();
    onProgress.onmessage = (p) => {
      if (current()) this.progress = p;
    };
    try {
      const buffer = await invoke<ArrayBuffer>("waveform", { onProgress });
      if (!current()) return;
      this.data = decodeWaveform(buffer);
      this.status = "ready";
    } catch (e) {
      if (!current()) return;
      this.error = String(e);
      this.status = "error";
    }
  }
}

export const waveform = new WaveformLoader();
