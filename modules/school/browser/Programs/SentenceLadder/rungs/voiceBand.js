/**
 * The arithmetic behind the recording rung's voice band — pure, so it can be
 * tested without a canvas or an AudioContext.
 *
 * The band is a row of mirrored bars. While the microphone is live each bar is
 * one recent level sample and the row scrolls in from the right; once a take
 * exists the whole recording is fitted to the row and a playhead sweeps it.
 * Either way, bar HEIGHT is the only channel: loud is tall, silence is the
 * hairline. That is what lets the band double as the volume meter.
 */

/** Bars per rem of band width, and the space each takes. One value each. */
export const BAR_PITCH_PX = 6;
export const BAR_WIDTH_PX = 3;

/** How many bars fit across `widthPx`. Never zero, so a 0-width first paint
 *  cannot divide by it. */
export function barCount(widthPx) {
  return Math.max(1, Math.floor(widthPx / BAR_PITCH_PX));
}

/**
 * RMS level of one time-domain analyser frame (unsigned bytes, 128 = silence),
 * returned in 0..1. RMS rather than peak: a click on the desk is one tall
 * sample, a voice is a sustained one, and the meter should say "voice".
 */
export function rmsOfBytes(bytes) {
  if (!bytes?.length) return 0;
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const v = (bytes[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / bytes.length);
}

/**
 * A level a person would read as loudness. Raw RMS of ordinary speech sits
 * around 0.05–0.2, which drawn linearly is a band that never gets past a
 * fifth of its height; `gain` lifts it so a normal voice fills most of the
 * band and only shouting clips.
 */
export function shapeLevel(rms, gain = 4) {
  return Math.min(1, rms * gain);
}

/**
 * Fit decoded samples to `count` bars — each bar is the RMS of its slice, so a
 * whole take reads with the same weight the live band had. Scaled so the
 * loudest bar touches the top, but lifted by at most the live band's gain: a
 * quiet voice is still a picture of ITS shape, while a take of room noise is
 * NOT stretched into a full-height fake. Silence stays the hairline.
 */
export function binsFromSamples(samples, count, gain = 4) {
  const n = Math.max(1, count | 0);
  const out = new Float32Array(n);
  if (!samples?.length) return out;
  const per = samples.length / n;
  let max = 0;
  for (let b = 0; b < n; b += 1) {
    const start = Math.floor(b * per);
    const end = Math.max(start + 1, Math.floor((b + 1) * per));
    let sum = 0;
    for (let i = start; i < end && i < samples.length; i += 1) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / (end - start));
    out[b] = rms;
    if (rms > max) max = rms;
  }
  const scale = max > 0 ? Math.min(gain, 1 / max) : 0;
  for (let b = 0; b < n; b += 1) out[b] = Math.min(1, out[b] * scale);
  return out;
}

/**
 * Draw one frame. `levels` are 0..1, newest LAST; they are right-aligned so a
 * live row grows in from the right edge and a fitted take spans the width.
 * `playhead` (0..1) colours the bars already heard in `voice` and the rest in
 * `rest`; null means every bar is `voice`.
 */
export function drawBand(ctx, { width, height, levels, playhead = null, voice, rest, baseline }) {
  ctx.clearRect(0, 0, width, height);
  const mid = height / 2;
  const count = barCount(width);
  const minH = 2;

  ctx.fillStyle = baseline;
  ctx.fillRect(0, mid - 0.5, width, 1);

  if (!levels?.length) return;
  const shown = levels.length > count ? levels.subarray?.(levels.length - count) ?? levels.slice(-count) : levels;
  const firstX = width - shown.length * BAR_PITCH_PX;
  const heardUpTo = playhead == null ? shown.length : Math.floor(playhead * shown.length);

  for (let i = 0; i < shown.length; i += 1) {
    const h = Math.max(minH, shown[i] * (height - 4));
    const x = firstX + i * BAR_PITCH_PX + (BAR_PITCH_PX - BAR_WIDTH_PX) / 2;
    ctx.fillStyle = i < heardUpTo ? voice : rest;
    ctx.fillRect(x, mid - h / 2, BAR_WIDTH_PX, h);
  }
}
