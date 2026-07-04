// Walk the five brick folders under media/midi, parse each MusicXML brick's
// metadata + notes, bake a root-0 harmonic timeline (bricks are canonical-C),
// and cache the result by folder mtime. Consumed by the /loop-manifest endpoint
// and, downstream, by useLoopLibrary → libraryRanking (grid-based gate).

import path from 'path';
import { listFiles, readFile, getStats } from '#system/utils/FileIO.mjs';
import { musicXmlToNotes, readBrickMeta } from '../../../../shared/music/musicXmlToNotes.mjs';
import { harmonicTimeline } from '../../../../shared/music/harmonicTimeline.mjs';

const TYPE_FOLDERS = ['chords', 'basslines', 'melodies', 'ideas', 'percussion'];
const SKIP_HARMONY = new Set(['groove', 'percussion']);

const csv = (s) => (typeof s === 'string' && s.trim()
  ? s.split(',').map((x) => x.trim()).filter(Boolean)
  : []);

// ── tonic recovery ───────────────────────────────────────────────────────────
// The bricks are NOT uniformly in C — each is in its own key. The conversion
// ledger records the analyzer's chord-ROOT sequence (`harmonyKey`, note names
// like "F-A-C-G") and the tonic-relative `derivedRoman`. The tonic pitch class
// is therefore rootPc(harmonyKey[0]) − degree(roman[0]): e.g. roots A-F-C-G with
// roman vi-IV-I-V → tonic C; a single "I" chord rooted on F → tonic F. Playback
// transposes each loop by (keyShift − tonicPc) so "I" always sounds the jam key,
// and the harmonic timeline is built tonic-relative (rootOverride: tonicPc) so
// the consonance grid is genuinely key-conformed.
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ROMAN_BASE = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };

function noteNamePc(name) {
  const m = String(name || '').trim().toUpperCase().match(/^([A-G])([#B]?)/);
  if (!m) return null;
  const acc = m[2] === '#' ? 1 : m[2] === 'B' ? -1 : 0;
  return (((LETTER_PC[m[1]] + acc) % 12) + 12) % 12;
}

function romanDegree(token) {
  const m = String(token || '').trim().match(/^([b#]?)([ivIV]+)/);
  if (!m) return null;
  const deg = ROMAN_BASE[m[2].toUpperCase()];
  if (deg == null) return null;
  const acc = m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0;
  return (((deg + acc) % 12) + 12) % 12;
}

/** Tonic pitch class from the ledger's root sequence + roman, or null. */
export function computeTonicPc(harmonyKey, roman) {
  if (!harmonyKey || !Array.isArray(roman) || roman.length === 0) return null;
  const firstRoot = noteNamePc(String(harmonyKey).split('-')[0]);
  const deg = romanDegree(roman[0]);
  if (firstRoot == null || deg == null) return null;
  return (((firstRoot - deg) % 12) + 12) % 12;
}

/** Read the conversion ledger → Map(outputPath → { harmonyKey, roman }). */
function readLedger(midiDir) {
  const map = new Map();
  const raw = readFile(path.join(midiDir, '_workspace', '_ledger.jsonl'));
  if (!raw) return map;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j.output) map.set(j.output, { harmonyKey: j.harmonyKey, roman: j.derivedRoman });
    } catch { /* skip malformed row */ }
  }
  return map;
}

/** Filled-dot count of a braille cell (U+2800–U+28FF). */
function braillePopcount(cp) {
  let v = cp - 0x2800;
  let c = 0;
  while (v) { c += v & 1; v >>= 1; }
  return c;
}

/** Per-chord durations (in timeline slots = beats) from the canonical-name's
 *  braille suffixes: e.g. "VI⣿-II⠇-IIIsus4⠟-…" → [8, 3, 5, …].
 *
 *  Per the brick-library spec (media/midi/README.md §"Braille = rhythm"): each
 *  token carries one or more braille cells, "1 dot = 1 beat … Beat count =
 *  number of dots (popcount)", and durations > 8 beats repeat cells (⣿⠃ = 10) —
 *  so we sum the popcount of EVERY braille cell in the token. 1 beat = 1
 *  harmonic-timeline slot (4/4), so Σ dots === slot count; the caller only
 *  trusts the result when that holds, which also rejects the spec's edge cases
 *  (a leading meter-header glyph, or a syncopation mask that leaves a beat
 *  unclaimed). Reads the `canonical-name` METADATA field, never the filename.
 *  Returns null when ANY token lacks a braille suffix → even-distribution fallback. */
export function parseCanonicalDurations(canonicalName) {
  if (!canonicalName) return null;
  const toks = String(canonicalName).split('-').filter(Boolean);
  if (!toks.length) return null;
  const out = [];
  for (const tok of toks) {
    let dots = 0;
    let found = false;
    for (const ch of tok) {
      const cp = ch.codePointAt(0);
      if (cp >= 0x2800 && cp <= 0x28ff) { dots += braillePopcount(cp); found = true; }
    }
    if (!found) return null;
    out.push(dots);
  }
  return out;
}

/** Build one manifest entry from a brick's relative path + raw XML. Pure.
 *  `ledgerRow` (optional) supplies the analyzer's harmonyKey + roman for tonic
 *  recovery; absent → tonic assumed C (0). */
export function buildBrickEntry(relPath, xml, ledgerRow = null) {
  const meta = readBrickMeta(xml);
  const type = meta.type || 'idea';
  const tonicPc = computeTonicPc(ledgerRow?.harmonyKey, ledgerRow?.roman) ?? 0;
  const entry = {
    tonicPc,
    path: relPath,
    slug: meta['source-slug'] || meta['canonical-name'] || relPath,
    type,
    title: meta.title || '',
    genre: csv(meta.genre),
    emotion: csv(meta.emotion),
    tags: csv(meta.tags),
    quality: meta.quality || '',
    artist: meta.artist || '',
    bpm: meta.bpm ? Number(meta.bpm) : null,
    reverb: meta.reverb || '',
    roman: meta['derived-signature'] ? meta['derived-signature'].split('-').filter(Boolean) : [],
  };
  if (SKIP_HARMONY.has(type)) {
    entry.feel = meta['canonical-name'] || ''; // grooves have no harmonic content
    return entry;
  }
  try {
    const { ppq, notes, timeSig } = musicXmlToNotes(xml);
    if (!notes.length) {
      entry.needsReview = true;
      entry.needsReviewReason = 'parse-fail';
      return entry;
    }
    const tl = harmonicTimeline(notes, ppq, { rootOverride: tonicPc, timeSig });
    entry.timeline = tl.slots;
    entry.timelineRoot = tl.root; // the brick's tonic pc (key-conformed grid)
    entry.specificity = tl.specificity;
    // Per-chord slot spans from the canonical-name braille (uneven progressions).
    // Attached ONLY when it aligns 1:1 with roman[] AND sums to the slot count —
    // so the frontend ChordLane can highlight the EXACT sounding chord instead of
    // assuming even distribution; any mismatch omits it (even-distribution fallback).
    const durations = parseCanonicalDurations(meta['canonical-name']);
    if (durations
      && durations.length === entry.roman.length
      && durations.reduce((a, b) => a + b, 0) === entry.timeline.length) {
      entry.romanDurations = durations;
    }
  } catch (err) {
    entry.needsReview = true;
    entry.needsReviewReason = `engine-throw: ${err.message}`;
  }
  return entry;
}

/** Walk the five type folders under midiDir → array of manifest entries. */
export function buildManifest(midiDir) {
  const bricks = [];
  const ledger = readLedger(midiDir);
  for (const folder of TYPE_FOLDERS) {
    const dir = path.join(midiDir, folder);
    for (const file of listFiles(dir)) {
      if (!file.endsWith('.musicxml')) continue;
      const xml = readFile(path.join(dir, file));
      if (xml == null) continue;
      const relPath = `${folder}/${file}`;
      try {
        bricks.push(buildBrickEntry(relPath, xml, ledger.get(relPath)));
      } catch (err) {
        bricks.push({ path: relPath, type: folder, needsReview: true, needsReviewReason: `build-fail: ${err.message}` });
      }
    }
  }
  return bricks;
}

/** Folder-mtime signature — invalidates the cache when bricks are (re)generated. */
export function manifestSignature(midiDir) {
  return TYPE_FOLDERS.map((f) => {
    const st = getStats(path.join(midiDir, f));
    return `${f}:${st ? st.mtimeMs : 0}`;
  }).join('|');
}

let _cache = null; // { sig, bricks }

/** mtime-cached manifest. Pass { refresh: true } to force a rebuild. */
export function getManifest(midiDir, { refresh = false } = {}) {
  const sig = manifestSignature(midiDir);
  if (!refresh && _cache && _cache.sig === sig) return _cache.bricks;
  const bricks = buildManifest(midiDir);
  _cache = { sig, bricks };
  return bricks;
}

export default { buildBrickEntry, buildManifest, getManifest, manifestSignature };
