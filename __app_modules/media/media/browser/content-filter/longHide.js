import { hidePiece, isWholeFrame, BRIDGE_SEC } from './contentFilter.js';

/** Longest continuous whole-frame blur that stays a blur; past it the picture is hidden behind a card. */
export const DEFAULT_MAX_HIDE_SEC = 5;

// The effects that blur the whole picture when they carry no rect. A blackout already hides it.
const BLURS = new Set(['full-blur', 'blur', 'pixelate', 'censor-bar']);

/** The conversion threshold in seconds, or null when conversion is off (`maxSec` null or 0). */
export function maxHideSec(treatments) {
  const v = treatments?.['full-blur']?.maxSec;
  if (v === undefined) return DEFAULT_MAX_HIDE_SEC;
  const n = Number(v);
  return v === null || !Number.isFinite(n) || n <= 0 ? null : n;
}

/**
 * A long whole-frame blur is not watchable: every maximal run of whole-frame blur pieces (gaps up
 * to BRIDGE_SEC bridged) lasting longer than `maxSec` becomes one carded black picture over the
 * run's union, sound untouched. Shorter runs stay blurs; regional pieces never count. Hiding only
 * grows: the blackout covers everything the run did, plus its bridged gaps. Mutates `out`.
 * @returns {{runs: number, sec: number}}
 */
export function convertLongHides(out, treatments) {
  const max = maxHideSec(treatments);
  const none = { runs: 0, sec: 0 };
  if (max == null) return none;
  const members = out.filter((c) => BLURS.has(c.effect) && isWholeFrame(c)).sort((a, b) => a.in - b.in || a.out - b.out);
  if (!members.length) return none;
  const runs = [];
  for (const c of members) {
    const run = runs[runs.length - 1];
    if (run && c.in - run.out <= BRIDGE_SEC) { run.out = Math.max(run.out, c.out); run.pieces.push(c); } else runs.push({ in: c.in, out: c.out, pieces: [c] });
  }
  const long = runs.filter((r) => r.out - r.in > max);
  if (!long.length) return none;
  const drop = new Set(long.flatMap((r) => r.pieces));
  const made = long.map((r) => {
    const piece = hidePiece(r.pieces[0], { in: r.in, out: r.out }, { firstPiece: true }, treatments);
    piece.cues = [...new Set(r.pieces.flatMap((p) => p.cues || [String(p.id).split(/[#@]/)[0]]))];
    return piece;
  });
  out.splice(0, out.length, ...out.filter((c) => !drop.has(c)), ...made);
  return { runs: long.length, sec: long.reduce((s, r) => s + (r.out - r.in), 0) };
}
