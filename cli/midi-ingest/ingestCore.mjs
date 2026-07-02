// Pure ingest logic — no file I/O. Identity hashing (to collapse the 12-key
// redundancy), metadata merging across duplicate members, drum/groove file
// classification, enrichment carry-over, and the role-first target path. The
// CLI wrapper supplies the notes + paths; this decides shape.

import { mod12, semitonesToCanonical } from '../../shared/music/transpose.mjs';
import { isDrumTrack } from '../../shared/music/percussion.mjs';
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

/** Fraction of a file's notes that must sit on drum-detected tracks for the
 * whole FILE to ingest as a groove. Below this (but above zero, with channel-9
 * evidence) = mixed drum+pitched file → skipped with a report line. */
export const GROOVE_FILE_THRESHOLD = 0.9;

/**
 * Classify a parsed file's tracks for routing:
 *   'harmonic' — no drum evidence, OR drum-looking notes but ZERO channel-9
 *                evidence (`coverageSuggestion: true` in that case). Per
 *                isDrumTrack's JSDoc, coverage-only positives are suggestions —
 *                basslines/riffs in the 36–51 pitch region routinely cross the
 *                60% bar (verified on the real packs: 76 false positives) — so
 *                they NEVER flip a file's type; they are only counted for the
 *                CLI's hygiene report.
 *   'groove'   — at least one channel-9 drum track, and drum-detected tracks
 *                carry ≥ GROOVE_FILE_THRESHOLD of the file's notes.
 *   'mixed'    — channel-9 drum evidence but pitched material above the
 *                threshold's complement; skipped upstream, never auto-routed.
 *
 * `tracks` is [{ channel, notes: [{ midi, ... }] }].
 */
export function classifyDrums(tracks) {
  let total = 0; let drum = 0; let ch9 = false;
  for (const tr of tracks) {
    total += tr.notes.length;
    if (tr.notes.length === 0) continue;
    if (isDrumTrack({ channel: tr.channel, notes: tr.notes })) {
      drum += tr.notes.length;
      if (tr.channel === 9) ch9 = true;
    }
  }
  if (total === 0 || drum === 0) return { kind: 'harmonic' };
  if (!ch9) return { kind: 'harmonic', coverageSuggestion: true };
  const ratio = drum / total;
  if (ratio >= GROOVE_FILE_THRESHOLD) return { kind: 'groove' };
  return { kind: 'mixed', ratio };
}

/**
 * Index fields owned by the enrichment passes (loop-enrich.cli.mjs and
 * enrich-index), which the ingest itself never produces. On a re-ingest
 * `--write`, entries whose content is unchanged carry these forward so a full
 * rebuild doesn't wipe hours of enrichment; changed content drops them (stale)
 * for the next enrichment run to recompute.
 */
export const ENRICHMENT_FIELDS = Object.freeze([
  'signature', 'title',
  'timeline', 'timelineRoot', 'specificity', 'rootSource',
  'needsReview', 'needsReviewReason',
]);

/** The enrichment-owned subset of an existing index entry (only keys present). */
export function pickEnrichment(entry) {
  const out = {};
  for (const f of ENRICHMENT_FIELDS) {
    if (entry[f] !== undefined) out[f] = entry[f];
  }
  return out;
}

/**
 * slug → entry map of a previous index, for enrichment carry-over. Slugs that
 * appear more than once (path-collision groups share their merged slug) are
 * ambiguous and excluded — those entries simply get re-enriched.
 */
export function slugMap(entries) {
  const counts = new Map();
  for (const e of entries) counts.set(e.slug, (counts.get(e.slug) || 0) + 1);
  const map = new Map();
  for (const e of entries) {
    if (counts.get(e.slug) === 1) map.set(e.slug, e);
  }
  return map;
}

const ROLE_DIR = {
  'chord-progression': 'chord-progressions',
  melody: 'melodies',
  bassline: 'basslines',
  idea: 'ideas',
  groove: 'percussion',
};

const SOURCE_DIR = {
  'niko-chord': 'niko',
  'niko-master': 'niko',
  'melody-starters': 'starters',
  'groove-starters': 'starters',
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

export default {
  canonicalShift, noteSignature, mergeLoopGroup, targetPath,
  classifyDrums, GROOVE_FILE_THRESHOLD, pickEnrichment, slugMap, ENRICHMENT_FIELDS,
};
