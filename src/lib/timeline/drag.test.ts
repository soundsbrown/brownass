import { describe, expect, it } from "vitest";
import { createSpan, moveSpan, resizeSpan, snapTime, type SnapContext } from "./drag";

// 25 fps, 100 px per second: one frame is 4 px, the snap distance 0.08 s.
const ctx: SnapContext = {
  fps: 25,
  pxPerSec: 100,
  duration: 60,
  targets: [10, 20],
  snapToTargets: true,
};
const noTargets = { ...ctx, snapToTargets: false };
const frame = 1 / 25;

describe("snapTime", () => {
  it("rounds to the nearest frame", () => {
    expect(snapTime(1.015, ctx)).toBeCloseTo(1.0);
    expect(snapTime(1.025, ctx)).toBeCloseTo(1.04);
  });

  it("prefers a target within reach", () => {
    expect(snapTime(10.07, ctx)).toBe(10);
    expect(snapTime(10.1, ctx)).toBeCloseTo(10.12);
    expect(snapTime(10.07, noTargets)).toBeCloseTo(10.08);
  });

  it("stays inside the video", () => {
    expect(snapTime(-1, ctx)).toBe(0);
    expect(snapTime(61, ctx)).toBe(60);
  });
});

describe("moveSpan", () => {
  const span = { start: 5, end: 7 };

  it("keeps the length and lands on a frame", () => {
    const moved = moveSpan(span, 3.013, ctx);
    expect(moved.start).toBeCloseTo(3.0);
    expect(moved.end - moved.start).toBeCloseTo(2);
  });

  it("snaps whichever edge is closer to a target", () => {
    expect(moveSpan(span, 9.95, ctx)).toEqual({ start: 10, end: 12 });
    // The end (17.97 + 2 = 19.97) is 0.03 from 20; the start is far from 10.
    expect(moveSpan(span, 17.97, ctx)).toEqual({ start: 18, end: 20 });
  });

  it("stops at the ends of the video", () => {
    expect(moveSpan(span, -3, noTargets)).toEqual({ start: 0, end: 2 });
    expect(moveSpan(span, 59.5, noTargets)).toEqual({ start: 58, end: 60 });
  });
});

describe("resizeSpan", () => {
  const span = { start: 5, end: 7 };

  it("moves one edge, snapped", () => {
    expect(resizeSpan(span, "end", 9.93, frame, ctx)).toEqual({ start: 5, end: 10 });
    expect(resizeSpan(span, "start", 4.0, frame, ctx)).toEqual({ start: 4, end: 7 });
  });

  it("never makes the span shorter than the minimum", () => {
    expect(resizeSpan(span, "start", 8, frame, ctx)).toEqual({ start: 7 - frame, end: 7 });
    expect(resizeSpan(span, "end", 2, frame, ctx)).toEqual({ start: 5, end: 5 + frame });
  });
});

describe("createSpan", () => {
  it("works in either drag direction", () => {
    expect(createSpan(3, 5, frame, noTargets)).toEqual({ start: 3, end: 5 });
    expect(createSpan(5, 3, frame, noTargets)).toEqual({ start: 3, end: 5 });
  });

  it("is at least the minimum length, inside the video", () => {
    expect(createSpan(3, 3, frame, noTargets)).toEqual({ start: 3, end: 3 + frame });
    expect(createSpan(60, 60, frame, noTargets)).toEqual({ start: 60 - frame, end: 60 });
  });
});
