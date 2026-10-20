import { describe, expect, it } from "vitest";
import {
  PEAK_TO_HEIGHT,
  buildLevels,
  decodeWaveform,
  peakBetween,
  type Waveform,
} from "./waveform";

function waveform(base: number[], binsPerSecond = 10): Waveform {
  return { binsPerSecond, levels: buildLevels(Uint8Array.from(base)) };
}

describe("buildLevels", () => {
  it("halves each level, keeping the maximum", () => {
    const levels = buildLevels(Uint8Array.from([1, 5, 2, 0, 9]));
    expect(levels.map((l) => [...l])).toEqual([[1, 5, 2, 0, 9], [5, 2, 9], [5, 9], [9]]);
  });

  it("handles a single bin", () => {
    expect(buildLevels(Uint8Array.from([7])).length).toBe(1);
  });
});

describe("decodeWaveform", () => {
  it("reads the header and peaks", () => {
    const bytes = Uint8Array.from([0xe8, 0x03, 0, 0, 10, 20, 30]);
    const wf = decodeWaveform(bytes.buffer);
    expect(wf.binsPerSecond).toBe(1000);
    expect([...wf.levels[0]]).toEqual([10, 20, 30]);
  });
});

describe("peakBetween", () => {
  const base = Array.from({ length: 1000 }, (_, i) => (i === 637 ? 200 : i % 10));

  it("finds a single loud bin at every zoom level", () => {
    const wf = waveform(base);
    // Bin 637 covers 63.7-63.8 s at 10 bins per second.
    for (const span of [0.05, 0.1, 1, 7, 50]) {
      expect(peakBetween(wf, 63.75 - span / 2, 63.75 + span / 2)).toBe(200);
    }
  });

  it("is bounded by the exact maximum and the range widened by a quarter", () => {
    // Deterministic pseudo-random peaks and ranges.
    let seed = 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const bins = Array.from({ length: 5000 }, () => Math.floor(rand() ** 8 * 255));
    const wf = waveform(bins);
    const maxIn = (a: number, b: number) =>
      Math.max(0, ...bins.slice(Math.max(0, Math.floor(a)), Math.ceil(b)));

    for (let n = 0; n < 500; n++) {
      const a = rand() * 4000;
      const b = a + 0.5 + rand() ** 3 * 1000;
      const quarter = (b - a) / 4;
      const peak = peakBetween(wf, a / 10, b / 10);
      expect(peak).toBeGreaterThanOrEqual(maxIn(a, b));
      expect(peak).toBeLessThanOrEqual(maxIn(a - quarter, b + quarter));
    }
  });

  it("matches a brute-force maximum when the range is aligned", () => {
    const wf = waveform(base);
    for (const [a, b] of [
      [0, 1.6],
      [12.8, 25.6],
      [51.2, 76.8],
    ]) {
      const brute = Math.max(...base.slice(a * 10, b * 10));
      expect(peakBetween(wf, a, b)).toBe(brute);
    }
  });

  it("returns 0 past the end", () => {
    expect(peakBetween(waveform(base), 200, 201)).toBe(0);
  });
});

describe("PEAK_TO_HEIGHT", () => {
  it("maps 0 dB to full height and silence to nothing", () => {
    expect(PEAK_TO_HEIGHT[255]).toBe(1);
    expect(PEAK_TO_HEIGHT[0]).toBe(0);
    // Half scale is about -6 dB, an eighth of the way down a 48 dB range.
    expect(PEAK_TO_HEIGHT[128]).toBeCloseTo(1 - 6 / 48, 1);
  });
});
