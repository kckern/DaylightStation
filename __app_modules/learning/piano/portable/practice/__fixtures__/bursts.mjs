/**
 * Deterministic 8–40-note bursts cut from a note list (calibration of the
 * burst filter and the legitimacy judge).
 */
export function cutBursts(notes, maxBursts = 3) {
  const out = [];
  let i = 0;
  let k = 0;
  while (i < notes.length && out.length < maxBursts) {
    const len = 8 + ((k * 13) % 33);
    const slice = notes.slice(i, i + len);
    if (slice.length >= 8) out.push(slice);
    i += len + 40;
    k += 1;
  }
  return out;
}

/** audit-sittings.json notes ([sec, pitch, vel]) → PracticeEvents (ms). */
export const auditEvents = (notes) => notes.map(([t, note, velocity]) => ({ t: Math.round(t * 1000), note, velocity }));
/** mash.mjs notes ([ms, pitch, vel]) → PracticeEvents. */
export const mashEvents = (notes) => notes.map(([t, note, velocity]) => ({ t, note, velocity }));
