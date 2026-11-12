/**
 * The key a lesson is in, read from its title — so a presence check-in can
 * ask for that lesson's scale rather than always C.
 *
 * Pure (portable layer). Roots come back in the kiosk drill vocabulary
 * (sharps: C C# D D# E F F# G G# A A# B), so a flat-key title still deals a
 * scale the drill can load.
 */
import { DEFAULT_DRILL_ROOTS } from './goodFaith.mjs';

// Letter must be uppercase (no `i` flag) so "a Major 7 chord" is never a key.
const NAMED = /\b([A-G])(#|♯|b|♭|\s+sharp|\s+flat)?\s+(?:[Mm]ajor|[Pp]osition|[Ss]cale)\b/;
const KEY_OF = /\b[Kk]ey of ([A-G])(#|b)?\b/;

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function accidentalOf(raw) {
  const a = String(raw || '').trim().toLowerCase();
  if (a === '#' || a === '♯' || a === 'sharp') return 1;
  if (a === 'b' || a === '♭' || a === 'flat') return -1;
  return 0;
}

function spell(letter, accidental) {
  const i = SHARPS.indexOf(letter);
  return SHARPS[(i + accidental + 12) % 12];
}

/** The lesson's root in sharp spelling, or null when the title names none. */
export function lessonScaleRoot(title) {
  if (typeof title !== 'string' || !title) return null;
  const m = title.match(NAMED) || title.match(KEY_OF);
  if (!m) return null;
  return spell(m[1], accidentalOf(m[2]));
}

/**
 * The roots a check-in scale rotates through: the lesson's key when its title
 * names one; else the configured drill roots; else C, G, F.
 */
export function checkInRoots({ title, drillRoots } = {}) {
  const root = lessonScaleRoot(title);
  if (root) return { roots: [root], source: 'title' };
  const configured = Array.isArray(drillRoots)
    ? drillRoots.map((r) => /^[A-G](#|b)?$/.test(String(r)) ? spell(r[0], accidentalOf(r.slice(1))) : null).filter(Boolean)
    : [];
  if (configured.length) return { roots: configured, source: 'config' };
  return { roots: [...DEFAULT_DRILL_ROOTS], source: 'default' };
}
