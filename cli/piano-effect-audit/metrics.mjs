// metrics.mjs — pure acoustic metrics over mono PCM (Float32Array @ sampleRate).
// No I/O. The CLI handles ffmpeg decoding; these are the O(N) envelope measures
// the reverb verdict relies on (robust, no FFT).

/** Root-mean-square over [start, end). */
export function rms(samples, start = 0, end = samples.length) {
  let sum = 0;
  let n = 0;
  const a = Math.max(0, start | 0);
  const b = Math.min(samples.length, end | 0);
  for (let i = a; i < b; i++) { sum += samples[i] * samples[i]; n++; }
  return n ? Math.sqrt(sum / n) : 0;
}

/** Energy of the tail after a marker time, in dBFS. */
export function tailEnergyDb(samples, sampleRate, afterMs) {
  const start = Math.floor((afterMs / 1000) * sampleRate);
  const r = rms(samples, start);
  return 20 * Math.log10(r + 1e-9);
}

/**
 * Decay time (ms): from the post-marker envelope peak, time to fall `dropDb`.
 * Coarse RT-style measure on a windowed envelope. Returns null if never reached.
 */
export function decayTimeMs(samples, sampleRate, afterMs, dropDb = 20, winMs = 20) {
  const start = Math.floor((afterMs / 1000) * sampleRate);
  const win = Math.max(1, Math.floor((winMs / 1000) * sampleRate));
  const env = (i) => rms(samples, i, i + win);
  let peak = 0;
  let peakAt = start;
  for (let i = start; i < samples.length - win; i += win) {
    const e = env(i);
    if (e > peak) { peak = e; peakAt = i; }
  }
  if (peak <= 0) return null;
  const target = peak * Math.pow(10, -dropDb / 20);
  for (let i = peakAt; i < samples.length - win; i += win) {
    if (env(i) <= target) return ((i - peakAt) / sampleRate) * 1000;
  }
  return null;
}
