import { invoke } from "@tauri-apps/api/core";
import type { Seconds } from "$lib/time";

export interface VideoInfo {
  path: string;
  /** Display size, after applying any rotation metadata. */
  width: number;
  height: number;
  fps: number;
  duration: Seconds;
  videoCodec: string;
  audioCodec: string | null;
}

/** Shows the open-video dialog and probes the choice; `null` if cancelled. */
export function openVideo(): Promise<VideoInfo | null> {
  return invoke<VideoInfo | null>("open_video");
}

/** Reopens a video from the recent list (the backend checks it's on it). */
export function openRecent(path: string): Promise<VideoInfo> {
  return invoke<VideoInfo>("open_recent", { path });
}

export interface RecentVideo {
  path: string;
  exists: boolean;
}
