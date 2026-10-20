import { describe, expect, it } from "vitest";
import {
  clampView,
  fitView,
  follow,
  panBy,
  pickTicks,
  timeAt,
  xAt,
  zoomAt,
  zoomRange,
  type Extent,
} from "./view";

const extent: Extent = { duration: 600, width: 1200, fps: 25 };

describe("view", () => {
  it("fits the whole video when zoomed out", () => {
    const v = fitView(extent);
    expect(v).toEqual({ start: 0, pxPerSec: 2 });
    expect(xAt(v, 600)).toBe(1200);
  });

  it("keeps the time under the cursor fixed while zooming", () => {
    const v = { start: 100, pxPerSec: 10 };
    const before = timeAt(v, 300);
    const zoomed = zoomAt(v, extent, 300, 1.7);
    expect(zoomed.pxPerSec).toBeCloseTo(17);
    expect(timeAt(zoomed, 300)).toBeCloseTo(before);
  });

  it("clamps zoom between fit-to-width and the per-frame limit", () => {
    const [min, max] = zoomRange(extent);
    expect(zoomAt(fitView(extent), extent, 0, 0.1).pxPerSec).toBe(min);
    expect(zoomAt(fitView(extent), extent, 0, 1e6).pxPerSec).toBe(max);
    expect(max).toBe(25 * 60);
  });

  it("keeps the view inside the video", () => {
    expect(clampView({ start: -5, pxPerSec: 10 }, extent).start).toBe(0);
    // 120 s visible at 10 px/s, so the last possible start is 480 s.
    expect(clampView({ start: 590, pxPerSec: 10 }, extent).start).toBe(480);
    expect(panBy({ start: 0, pxPerSec: 10 }, extent, 100).start).toBe(10);
  });

  it("pages to follow the playhead only when it leaves the view", () => {
    const v = { start: 0, pxPerSec: 10 };
    expect(follow(v, extent, 60)).toBe(v);
    const paged = follow(v, extent, 130);
    expect(paged.start).toBeCloseTo(124);
    expect(xAt(paged, 130)).toBeGreaterThan(0);
  });

  it("does not zoom in past the limit on very short videos", () => {
    const short: Extent = { duration: 0.2, width: 1200, fps: 25 };
    const [min, max] = zoomRange(short);
    expect(min).toBe(max);
  });
});

describe("pickTicks", () => {
  it("labels ticks at least 90 px apart and picks the smallest such step", () => {
    for (const pxPerSec of [0.05, 0.5, 2, 20, 100, 400, 1500]) {
      const { major } = pickTicks(pxPerSec, 25);
      expect(major * pxPerSec).toBeGreaterThanOrEqual(90);
    }
    expect(pickTicks(20, 25).major).toBe(5);
  });

  it("uses whole-frame steps below one second", () => {
    const t = pickTicks(1500, 25);
    expect(t.major).toBeCloseTo(2 / 25);
    expect(t.decimals).toBe(2);
    expect(Math.round(t.major * 25) % t.subdivisions).toBe(0);
  });

  it("uses frame steps at non-integer frame rates", () => {
    const fps = 30000 / 1001;
    const t = pickTicks(1000, fps);
    expect(t.major).toBeCloseTo(5 / fps);
    expect(t.subdivisions).toBe(5);
  });

  it("subdivides second steps", () => {
    expect(pickTicks(100, 25)).toEqual({ major: 1, subdivisions: 10, decimals: 0 });
  });
});
