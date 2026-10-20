import type { Seconds } from "$lib/time";

/** Audio peaks at several resolutions; level `k` has one value per `2^k` base bins. */
export interface Waveform {
  binsPerSecond: number;
  levels: Uint8Array[];
}

/** Lowest level shown; peaks are 8-bit, so 1/255 is about -48 dB. */
const FLOOR_DB = -48;

/** Decodes the backend's `[u32 LE bins per second][u8 peak]*` payload. */
export function decodeWaveform(buffer: ArrayBuffer): Waveform {
  const binsPerSecond = new DataView(buffer).getUint32(0, true);
  return { binsPerSecond, levels: buildLevels(new Uint8Array(buffer, 4)) };
}

/** Builds successively halved levels, each bin the max of the two below it. */
export function buildLevels(base: Uint8Array): Uint8Array[] {
  const levels = [base];
  for (let prev = base; prev.length > 1;) {
    const next = new Uint8Array(Math.ceil(prev.length / 2));
    for (let i = 0; i < next.length; i++) {
      next[i] = Math.max(prev[2 * i], prev[2 * i + 1] ?? 0);
    }
    levels.push(next);
    prev = next;
  }
  return levels;
}

/**
 * Peak (0-255) between `t0` and `t1`. Reads a level whose bins are at most a
 * quarter of the range, so each call touches a handful of bins at any zoom,
 * and edge bins spill at most a quarter of the range past either end.
 */
export function peakBetween(wf: Waveform, t0: Seconds, t1: Seconds): number {
  const a = Math.max(0, t0 * wf.binsPerSecond);
  const b = t1 * wf.binsPerSecond;
  const level = Math.min(Math.max(0, Math.floor(Math.log2(b - a)) - 2), wf.levels.length - 1);
  const bins = wf.levels[level];
  const scale = 2 ** level;
  const first = Math.floor(a / scale);
  const last = Math.min(bins.length, Math.max(first + 1, Math.ceil(b / scale)));
  let peak = 0;
  for (let i = first; i < last; i++) peak = Math.max(peak, bins[i]);
  return peak;
}

/** Display height (0-1) for each 8-bit peak, on a dB scale. */
export const PEAK_TO_HEIGHT: Float32Array = (() => {
  const table = new Float32Array(256);
  for (let v = 1; v < 256; v++) {
    const db = 20 * Math.log10(v / 255);
    table[v] = Math.max(0, 1 - db / FLOOR_DB);
  }
  return table;
})();
