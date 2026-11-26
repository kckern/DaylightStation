/**
 * Audiobook chapters: the rules that decide whether a chapter list belongs to a
 * track, and its one shape. Pure. See ops:docs/superpowers/specs/2026-11-26-phone-audiobook-chapters.md.
 */

/** How far two durations (or a chapter edge and the file's end) may differ, in ms. */
export const CHAPTER_TOLERANCE_MS = 2000;

/**
 * The book's folder as the last two folders (author / book), lower-cased: what a Plex
 * file path and an Audiobookshelf item path have in common although they are mounted
 * at different roots. A file path drops its file name first.
 * @param {string} p
 * @param {{isFile?: boolean}} [opts]
 * @returns {string|null}
 */
export function folderKey(p, { isFile = false } = {}) {
  if (typeof p !== 'string' || !p.trim()) return null;
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (isFile) parts.pop();
  if (parts.length < 2) return null;
  return parts.slice(-2).map((s) => s.normalize('NFC').toLowerCase().trim()).join('/');
}

/** Two durations in ms close enough to be the same file. */
export function sameLength(aMs, bMs) {
  return Number.isFinite(aMs) && Number.isFinite(bMs) && aMs > 0 && bMs > 0 && Math.abs(aMs - bMs) <= CHAPTER_TOLERANCE_MS;
}

/**
 * Chapters as `[{startMs, endMs, title}]`, or `{reason}` when they cannot be trusted:
 * fewer than two, not starting at 0, out of order, or not ending at the file's end.
 * @param {Array<{start?: number, end?: number, startMs?: number, endMs?: number, title?: string}>} raw
 *   seconds (start/end, Audiobookshelf) or ms (startMs/endMs, Plex)
 * @param {number} durationMs - the track's own length
 * @returns {{chapters: Array<{startMs:number,endMs:number,title:string}>}|{reason: string}}
 */
export function normalizeChapters(raw, durationMs) {
  if (!Array.isArray(raw) || raw.length < 2) return { reason: 'too-few' };
  const out = [];
  for (const c of raw) {
    const startMs = Number.isFinite(c?.startMs) ? c.startMs : Math.round(Number(c?.start) * 1000);
    const endMs = Number.isFinite(c?.endMs) ? c.endMs : Math.round(Number(c?.end) * 1000);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return { reason: 'bad-chapters' };
    const title = typeof c?.title === 'string' ? c.title.trim().slice(0, 200) : '';
    out.push({ startMs, endMs, title });
  }
  for (let i = 1; i < out.length; i++) {
    if (out[i].startMs < out[i - 1].startMs || out[i].startMs < out[i - 1].endMs - CHAPTER_TOLERANCE_MS) return { reason: 'bad-chapters' };
  }
  if (out[0].startMs > CHAPTER_TOLERANCE_MS) return { reason: 'bad-chapters' };
  if (Number.isFinite(durationMs) && durationMs > 0
      && Math.abs(out.at(-1).endMs - durationMs) > CHAPTER_TOLERANCE_MS) return { reason: 'duration-mismatch' };
  out[0].startMs = 0;
  return { chapters: out };
}
