import { describe, expect, it } from "vitest";
import { formatAssTime, formatTime, frameAt, frameCount, parseAssTime, timeOfFrame } from "./time";

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

describe("ASS timestamps", () => {
  it("rounds down to the centisecond", () => {
    expect(formatAssTime(1.234)).toBe("0:00:01.23");
    expect(formatAssTime(1.239)).toBe("0:00:01.23");
    expect(formatAssTime(3599.999)).toBe("0:59:59.99");
    expect(formatAssTime(3723.5)).toBe("1:02:03.50");
  });

  it("ignores float noise just below a centisecond", () => {
    // 5.01 * 100 is 500.99999999999994 in floating point.
    expect(formatAssTime(5.01)).toBe("0:00:05.01");
  });

  it.each([
    ["23.976", FILM],
    ["25", 25],
    ["29.97", NTSC],
    ["59.94", 60000 / 1001],
  ])("lands every frame start of an hour at %s fps on that frame", (_, fps) => {
    for (let f = 1; f < frameCount(3600, fps); f++) {
      const written = parseAssTime(formatAssTime(timeOfFrame(f, fps)))!;
      // A renderer shows frame f's events iff start <= frame time.
      expect(written).toBeLessThanOrEqual(timeOfFrame(f, fps) + 1e-9);
      expect(written).toBeGreaterThan(timeOfFrame(f - 1, fps));
    }
  });

  it("parses what it formats", () => {
    for (const t of [0, 0.01, 1.23, 59.99, 3723.5]) {
      expect(parseAssTime(formatAssTime(t))).toBeCloseTo(t, 6);
    }
  });

  it("parses leniently and rejects garbage", () => {
    expect(parseAssTime("0:00:01.5")).toBeCloseTo(1.5);
    expect(parseAssTime(" 0:00:01.500 ")).toBeCloseTo(1.5);
    expect(parseAssTime("0:00:01")).toBe(1);
    expect(parseAssTime("1.5")).toBeNull();
    expect(parseAssTime("a:00:01.00")).toBeNull();
  });
});
