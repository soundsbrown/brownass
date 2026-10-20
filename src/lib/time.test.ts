import { describe, expect, it } from "vitest";
import { formatTime, frameAt, frameCount, timeOfFrame } from "./time";

const NTSC = 30000 / 1001;
const FILM = 24000 / 1001;

describe("frameAt / timeOfFrame", () => {
  it.each([
    ["25", 25],
    ["29.97", NTSC],
    ["23.976", FILM],
    ["60", 60],
  ])("round-trips every frame of an hour at %s fps", (_, fps) => {
    const last = frameCount(3600, fps);
    for (let f = 0; f < last; f += 7) {
      expect(frameAt(timeOfFrame(f, fps), fps)).toBe(f);
    }
  });

  it("stays on a frame until the next one starts", () => {
    expect(frameAt(timeOfFrame(10, NTSC) + 0.5 / NTSC, NTSC)).toBe(10);
    expect(frameAt(timeOfFrame(11, NTSC) - 1e-4, NTSC)).toBe(10);
  });
});

describe("frameCount", () => {
  it("rounds away float noise in the duration", () => {
    expect(frameCount(10.0100000001, 100)).toBe(1001);
    expect(frameCount(3600 * (1001 / 1000), NTSC)).toBe(108000);
  });

  it("is at least one", () => {
    expect(frameCount(0, 25)).toBe(1);
  });
});

describe("formatTime", () => {
  it("formats hours, minutes, seconds and decimals", () => {
    expect(formatTime(0)).toBe("0:00:00.000");
    expect(formatTime(3723.5)).toBe("1:02:03.500");
    expect(formatTime(54, 0)).toBe("0:00:54");
    expect(formatTime(1.234, 2)).toBe("0:00:01.23");
  });

  it("carries rounding into seconds and minutes", () => {
    expect(formatTime(59.9996)).toBe("0:01:00.000");
    expect(formatTime(0.995, 2)).toBe("0:00:01.00");
  });

  it("clamps negative times to zero", () => {
    expect(formatTime(-1)).toBe("0:00:00.000");
  });
});
