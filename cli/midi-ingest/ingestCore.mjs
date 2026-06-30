// Pure ingest logic — no file I/O. Identity hashing (to collapse the 12-key
// redundancy), metadata merging across duplicate members, and the role-first
// target path. The CLI wrapper supplies the notes + paths; this decides shape.

import { mod12, semitonesToCanonical } from '../../shared/music/transpose.mjs';
import { kebab } from './loopMeta.mjs';

/** Semitone shift that moves a major-key tonic onto the canonical C. */
export function canonicalShift(majorTonic) {
  return semitonesToCanonical(majorTonic, 0);
}

/**
 * Canonical pitch-class signature of a loop — identical for all transpositions
 * of the same idea. `notes` is [{ ticks, midi }]; `shift` is canonicalShift(tonic).
 */
export function noteSignature(notes, shift) {
  return notes
    .map((n) => ({ t: n.ticks, pc: mod12(n.midi + shift) }))
    .sort((a, b) => a.t - b.t || a.pc - b.pc)
    .map((n) => `${n.t}:${n.pc}`)
    .join('|');
}

const firstDefined = (entries, pick) => {
  for (const e of entries) {
    const v = pick(e);
    if (v !== null && v !== undefined) return v;
  }
  return null;
};

/**
 * Merge duplicate members (same signature) into one canonical LoopEntry.
 * Prefers the C-major member as canonical; unions keys, sources, and metadata.
 */
export function mergeLoopGroup(entries) {
  const canonical = entries.find((e) => e.key?.major === 0) || entries[0];
  const availableKeys = [...new Set(entries.map((e) => e.key?.raw).filter(Boolean))];
  const sources = [...new Set(entries.map((e) => e.source).filter(Boolean))];

  return {
    ...canonical,
    availableKeys,
    sources,
    mood: firstDefined(entries, (e) => e.mood),
    bpm: firstDefined(entries, (e) => e.bpm),
    descriptor: firstDefined(entries, (e) => e.descriptor),
    chords: firstDefined(entries, (e) => e.chords),
    degrees: firstDefined(entries, (e) => e.degrees),
  };
}

const ROLE_DIR = {
  'chord-progression': 'chord-progressions',
  melody: 'melodies',
  bassline: 'basslines',
  idea: 'ideas',
};

const SOURCE_DIR = {
  'niko-chord': 'niko',
  'niko-master': 'niko',
  'melody-starters': 'starters',
  famous: 'famous',
};

/** Role-first destination path within the canonical tree. */
export function targetPath(entry) {
  const role = ROLE_DIR[entry.type] || 'other';
  let group = SOURCE_DIR[entry.source] || entry.source || 'misc';
  if (entry.source === 'famous' && entry.artist) group = `famous/${kebab(entry.artist)}`;
  const segments = [role, group];
  if (entry.mood) segments.push(kebab(entry.mood));
  segments.push(`${entry.slug}.mid`);
  return segments.join('/');
}

export default { canonicalShift, noteSignature, mergeLoopGroup, targetPath };
