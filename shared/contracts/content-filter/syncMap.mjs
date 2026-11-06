/**
 * Map content-filter cue times from the reference clock (VidAngel seconds) onto
 * one copy of a title, and back.
 *
 * A sync is either a single linear map `{ scale, offsetSec }` or a list of
 * segments `{ segments: [{ fromVa, toVa, scale, offsetSec }] }` for copies whose
 * cut differs (scenes added or removed). Within a segment:
 *   local = va * scale + offsetSec
 * A reference time in no segment is a scene this copy does not have. A segment
 * may carry `fuzzyFromVa`/`fuzzyToVa`: how far it might really reach when the
 * cut between it and its neighbour could only be bracketed by anchors.
 *
 * Pure; shared by the player (resolving cues) and the CLI (writing refined EDLs).
 */

const EPS = 1e-6;

/** @returns {Array<{ fromVa: number, toVa: number, scale: number, offsetSec: number }>} */
export function segmentsOf(sync) {
  if (sync?.segments?.length) {
    return [...sync.segments]
      .map((s) => ({
        fromVa: s.fromVa, toVa: s.toVa, scale: s.scale ?? 1, offsetSec: s.offsetSec || 0,
        ...(s.fuzzyFromVa != null ? { fuzzyFromVa: s.fuzzyFromVa } : {}),
        ...(s.fuzzyToVa != null ? { fuzzyToVa: s.fuzzyToVa } : {}),
      }))
      .sort((a, b) => a.fromVa - b.fromVa);
  }
  return [{ fromVa: -Infinity, toVa: Infinity, scale: sync?.scale ?? 1, offsetSec: sync?.offsetSec || 0 }];
}

const toLocal = (va, s) => va * s.scale + s.offsetSec;
const toVa = (local, s) => (local - s.offsetSec) / s.scale;

/** Reference time -> this copy's time, or null when this copy lacks that moment. */
export function mapTime(va, sync) {
  const seg = segmentsOf(sync).find((s) => va >= s.fromVa && va < s.toVa);
  return seg ? toLocal(va, seg) : null;
}

/** This copy's time -> reference time, or null for footage the reference does not have. */
export function unmapTime(local, sync) {
  for (const s of segmentsOf(sync)) {
    const lo = Number.isFinite(s.fromVa) ? toLocal(s.fromVa, s) : -Infinity;
    const hi = Number.isFinite(s.toVa) ? toLocal(s.toVa, s) : Infinity;
    if (local >= lo - EPS && local < hi) return toVa(local, s);
  }
  return null;
}

/**
 * Map a reference span onto this copy. A span crossing a segment boundary comes
 * back as one part per segment; parts in scenes this copy lacks are dropped.
 * @returns {Array<{ in: number, out: number }>}
 */
export function mapSpan(vaIn, vaOut, sync) {
  const parts = [];
  for (const s of segmentsOf(sync)) {
    // Where a cut's exact place is unknown (between the anchors either side of
    // it), a segment may reach into its neighbour: spans there map through both,
    // so the moment is covered wherever the cut really is.
    const lo = s.fuzzyFromVa ?? s.fromVa; const hi = s.fuzzyToVa ?? s.toVa;
    const a = Math.max(vaIn, lo); const b = Math.min(vaOut, hi);
    if (b > a || (b === a && vaIn === vaOut && a >= lo && a < hi)) {
      parts.push({ in: toLocal(a, s), out: toLocal(b, s) });
    }
  }
  return parts;
}

export function parseFps(fps) {
  if (typeof fps === 'number') return fps;
  const [n, d] = String(fps || '').split('/').map(Number);
  return d ? n / d : n || null;
}

/**
 * Snap a mapped span to a copy's frame grid: `in` to the start of the frame it
 * falls in, `out` to the end of its frame (an edge already on a boundary stays).
 * Without a frame grid the span is returned unchanged.
 * @param {{ in: number, out: number }} span
 * @param {{ fps: string|number, startTime?: number }|null} frames
 */
export function snapToFrames(span, frames) {
  const fps = parseFps(frames?.fps);
  if (!fps) return span;
  const dur = 1 / fps; const t0 = frames.startTime || 0;
  // Tolerance in frames: reference times are stored to the millisecond and start
  // times are rounded (0.083333 for 1/12), so an edge that was on a boundary comes
  // back up to ~0.5 ms off it. 0.05 frame is 2 ms at 24 fps.
  const tol = 0.05;
  const nIn = Math.floor((span.in - t0) * fps + tol);
  const nOut = Math.ceil((span.out - t0) * fps - tol);
  const inT = t0 + nIn * dur;
  return { in: inT, out: Math.max(t0 + nOut * dur, inT + dur) };
}
