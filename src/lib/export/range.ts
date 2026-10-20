import type { Project } from "$lib/model/project";
import type { Seconds } from "$lib/time";

/** A part of the video to export: from `start` up to (not including) `end`. */
export interface ExportRange {
  start: Seconds;
  end: Seconds;
}

/** What ffmpeg is told: seek to `seek`, then encode `duration` seconds. */
export interface FfmpegRange {
  seek: Seconds;
  duration: Seconds;
  /** The range as chosen, for naming the output. */
  start: Seconds;
  end: Seconds;
}

/**
 * Seeking at the input makes ffmpeg drop frames before the seek point and
 * restart timestamps from it. Both ends move half a frame early so float
 * rounding can't drop the first frame or include the frame at `end`.
 */
export function ffmpegRange(range: ExportRange, fps: number): FfmpegRange {
  const half = 0.5 / fps;
  const seek = Math.max(0, range.start - half);
  return { seek, duration: range.end - half - seek, start: range.start, end: range.end };
}

/**
 * The project as seen from `seek`: only captions overlapping the range,
 * clipped to it and shifted back by `seek`. Exported with an input seek to
 * the same point, its subtitles line up with the trimmed video exactly.
 */
export function projectForRange(project: Project, range: ExportRange, seek: Seconds): Project {
  const items = project.items.flatMap((item) => {
    const start = Math.max(item.start, range.start);
    const end = Math.min(item.end, range.end);
    return end > start ? [{ ...item, start: start - seek, end: end - seek }] : [];
  });
  return { ...project, items };
}
