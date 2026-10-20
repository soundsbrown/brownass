import { invoke } from "@tauri-apps/api/core";

export interface FfmpegInfo {
  version: string;
  ffmpegPath: string;
  ffprobePath: string;
}

export type FfmpegErrorKind = "notFound" | "ffprobeMissing" | "noLibass" | "failed";

export interface FfmpegError {
  kind: FfmpegErrorKind;
  message: string;
}

/** Finds and verifies ffmpeg (saved path first, then PATH). */
export function ffmpegStatus(): Promise<FfmpegInfo> {
  return invoke<FfmpegInfo>("ffmpeg_status").catch(rethrow);
}

/** Opens a file picker for ffmpeg; resolves to `null` if cancelled. */
export function locateFfmpeg(): Promise<FfmpegInfo | null> {
  return invoke<FfmpegInfo | null>("locate_ffmpeg").catch(rethrow);
}

function rethrow(e: unknown): never {
  throw toFfmpegError(e);
}

export function toFfmpegError(e: unknown): FfmpegError {
  if (typeof e === "object" && e !== null && "kind" in e && "message" in e) {
    return e as FfmpegError;
  }
  return { kind: "failed", message: String(e) };
}
