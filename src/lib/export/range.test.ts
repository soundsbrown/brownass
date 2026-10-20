import { describe, expect, it } from "vitest";
import { serializeAss } from "$lib/ass/serialize";
import { createProject } from "$lib/model/defaults";
import type { Project, TextItem } from "$lib/model/project";
import { frameAt, timeOfFrame } from "$lib/time";
import { ffmpegRange, projectForRange } from "./range";

const NTSC = 30000 / 1001;

function project(): Project {
  const p = createProject({ path: "v", width: 1280, height: 720, fps: NTSC, duration: 20 });
  const item = (id: string, start: number, end: number): TextItem => ({
    id,
    type: "text",
    start,
    end,
    layer: 0,
    text: id,
    styleName: "Default",
  });
  p.items = [
    item("before", 1, 2),
    item("across start", 9, 11),
    item("inside", timeOfFrame(360, NTSC), 13),
    item("across end", 14, 16),
    item("after", 17, 18),
  ];
  return p;
}

describe("ffmpegRange", () => {
  it("seeks and stops half a frame early", () => {
    const r = ffmpegRange({ start: timeOfFrame(300, NTSC), end: timeOfFrame(450, NTSC) }, NTSC);
    expect(r.seek).toBeCloseTo(9.993317, 6);
    // Frames at or after the seek and before seek + duration: 300 to 449.
    expect(frameAt(r.seek + 0.5 / NTSC, NTSC)).toBe(300);
    expect((r.seek + r.duration) * NTSC).toBeCloseTo(449.5, 6);
  });

  it("doesn't seek before the start of the video", () => {
    expect(ffmpegRange({ start: 0, end: 5 }, 25).seek).toBe(0);
  });
});

describe("projectForRange", () => {
  const range = { start: timeOfFrame(300, NTSC), end: 15 };
  const { seek } = ffmpegRange(range, NTSC);
  const shifted = projectForRange(project(), range, seek);
  const byId = Object.fromEntries(shifted.items.map((i) => [i.id, i]));

  it("keeps only captions overlapping the range, clipped to it", () => {
    expect(Object.keys(byId)).toEqual(["across start", "inside", "across end"]);
    expect(byId["across start"].start).toBeCloseTo(range.start - seek);
    expect(byId["across end"].end).toBeCloseTo(15 - seek);
  });

  it("shifts times by the seek, so the subtitle starts on the same frame", () => {
    // The caption starts on source frame 360, which is output frame 60.
    const start = byId["inside"].start;
    expect(frameAt(start + seek, NTSC)).toBe(360);
    expect(serializeAss(shifted)).toContain(
      "Dialogue: 0,0:00:02.01,0:00:03.00,Default,,0,0,0,,inside",
    );
  });
});
