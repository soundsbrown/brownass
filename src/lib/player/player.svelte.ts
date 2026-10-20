import { convertFileSrc } from "@tauri-apps/api/core";
import { frameAt, frameCount, timeOfFrame, type Seconds } from "$lib/time";
import type { VideoInfo } from "./api";

// Seeking to exactly a frame's start time can show the previous frame because
// of rounding in the decoder, so seeks aim slightly inside the frame.
const SEEK_OFFSET: Seconds = 1e-4;

/** Playback state for the loaded video, shared by the player and timeline. */
export class Player {
  video = $state<VideoInfo | null>(null);
  src = $state<string | null>(null);
  /** Start time of the frame currently shown. */
  time = $state<Seconds>(0);
  playing = $state(false);
  error = $state<string | null>(null);

  #el: HTMLVideoElement | null = null;
  #frameRequest = 0;

  get fps(): number {
    return this.video?.fps ?? 30;
  }

  get duration(): Seconds {
    return this.video?.duration ?? 0;
  }

  get frame(): number {
    return frameAt(this.time, this.fps);
  }

  get lastFrame(): number {
    return frameCount(this.duration, this.fps) - 1;
  }

  load(info: VideoInfo): void {
    this.#el?.pause();
    this.video = info;
    this.src = convertFileSrc(info.path);
    this.time = 0;
    this.playing = false;
    this.error = null;
  }

  /** Binds the `<video>` element; returns a cleanup function. */
  attach(el: HTMLVideoElement): () => void {
    this.#el = el;
    const listeners: [string, () => void][] = [
      ["play", this.#onPlay],
      ["pause", this.#onStop],
      ["ended", this.#onStop],
      ["seeked", this.#onSeeked],
      ["error", this.#onError],
    ];
    for (const [type, fn] of listeners) el.addEventListener(type, fn);
    return () => {
      for (const [type, fn] of listeners) el.removeEventListener(type, fn);
      el.cancelVideoFrameCallback(this.#frameRequest);
      if (this.#el === el) this.#el = null;
    };
  }

  togglePlay(): void {
    const el = this.#el;
    if (!el || !this.video) return;
    if (el.paused) {
      el.play().catch((e) => (this.error = String(e)));
    } else {
      el.pause();
    }
  }

  /** Seeks to the frame shown at time `t`. */
  seek(t: Seconds): void {
    this.seekFrame(frameAt(t, this.fps));
  }

  seekFrame(frame: number): void {
    const el = this.#el;
    if (!el || !this.video) return;
    const f = Math.min(Math.max(frame, 0), this.lastFrame);
    this.time = timeOfFrame(f, this.fps);
    el.currentTime = Math.min(this.time + SEEK_OFFSET, this.duration);
  }

  step(frames: number): void {
    this.seekFrame(this.frame + frames);
  }

  #snap(t: Seconds): Seconds {
    return timeOfFrame(frameAt(t, this.fps), this.fps);
  }

  #onPlay = () => {
    this.playing = true;
    if (this.#el) this.#frameRequest = this.#el.requestVideoFrameCallback(this.#onFrame);
  };

  #onStop = () => {
    this.playing = false;
    if (!this.#el) return;
    this.#el.cancelVideoFrameCallback(this.#frameRequest);
    this.time = this.#snap(this.#el.currentTime);
  };

  #onSeeked = () => {
    if (this.#el && !this.playing) this.time = this.#snap(this.#el.currentTime);
  };

  // requestVideoFrameCallback reports the presentation time of each frame
  // actually shown, which keeps the playhead frame-accurate during playback.
  #onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
    this.time = this.#snap(meta.mediaTime);
    if (this.playing && this.#el) {
      this.#frameRequest = this.#el.requestVideoFrameCallback(this.#onFrame);
    }
  };

  #onError = () => {
    const err = this.#el?.error;
    if (!err) return;
    const codec = this.video?.videoCodec;
    this.error =
      err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
      err.code === MediaError.MEDIA_ERR_DECODE
        ? `The preview can't play this file${codec ? ` (video codec: ${codec})` : ""}.`
        : `Playback failed: ${err.message || `error ${err.code}`}`;
  };
}

export const player = new Player();
