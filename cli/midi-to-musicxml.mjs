// MIDI -> MusicXML converter for the self-indexing loop migration.
// Design: docs/plans/2026-07-03-self-indexing-midi-loops-design.md
//
// SAFETY: reads canonical loops/*.mid (never mutates them) and writes MusicXML
// into a SEPARATE staging tree, plus a JSONL ledger. Revert = delete the tree.
//
// TRACEABILITY: every emitted MusicXML embeds its full genesis (source .mid,
// vendor origin, source pack, converter/analyzer versions, timestamp, and a
// derived-harmony snapshot) in <identification><miscellaneous>, and the ledger
// records one row per output describing exactly how it was produced.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import pkg from '@tonejs/midi';
import { mod12 } from '../shared/music/transpose.mjs';
import { romanAnalysis, bestTonic, degreeNumeral } from '../shared/music/romanAnalysis.mjs';
import { signatureKey, minimalCycle } from '../shared/music/harmonicSignature.mjs';

const { Midi } = pkg;

export const CONVERTER_VERSION = 'midi2xml/0.2.0';
export const ANALYZER_VERSION = 'harmony-v2-bass-informed/0.1.0';
const DIVISIONS = 4; // divisions per quarter note (16th-note quantization grid)

// ---------- descriptor / tag extraction (surfaced in the UX) ----------
// Genre + emotion vocabularies. Tokens are drawn from the source path folders,
// `mood`, and `descriptor`, then matched against these to build clean, filterable
// tags. Everything else (structural folder names, bpm tiers) is dropped as noise.
const GENRE = new Set(['jazz', 'hip-hop', 'hiphop', 'rock', 'house', 'lofi', 'reggaeton', 'rnb', 'r-b', 'pop', 'edm', 'trap', 'dance', 'disco', 'country', 'reggae', 'afro', 'ambient', 'cinematic', 'soul', 'funk', 'blues', 'latin', 'waltz', 'swing', 'orchestral', 'folk', 'gospel', 'techno']);
const EMOTION = new Set(['dark', 'happy', 'sad', 'emotional', 'mysterious', 'beautiful', 'sexy', 'smooth', 'relax', 'relaxing', 'chill', 'heartbroken', 'dreamy', 'uplifting', 'intense', 'soulful', 'peaceful', 'romantic', 'loving', 'suspenseful', 'memorable', 'catchy', 'energetic', 'aggressive', 'hopeful', 'nostalgic', 'epic', 'groovy', 'bright', 'moody', 'tense', 'blessed', 'awesome', 'gorgeous', 'inspiring', 'sensual']);
const DROP = new Set(['chord', 'chords', 'progression', 'progressions', 'melody', 'melodies', 'bassline', 'basslines', 'idea', 'ideas', 'niko', 'famous', 'starters', 'starter', 'more', 'extras', 'extra', 'rhythms', 'rhythm', 'rhythmic', 'prog', 'from', 'songs', 'song', 'piano', 'intros', 'intro', 'arps', 'arp', 'pack', 'kotoulas', 'best', 'advanced', 'back', 'forth', 'slower', 'add', 'sus', 'alt', 'dim', 'the', 'and', 'of', 'master', 'variations', 'variation', 'consistent', 'perfect5th', 'perfect',
  // origin/path noise: key names, reverb tags, vendor batch words
  'major', 'minor', 'dry', 'wet', 'bonus', 'tophits', 'hits', 'top', 'mix', 'midi', 'sharp', 'flat', 'verse', 'chorus', 'intro', 'outro', 'bridge', 'pre', 'hook', 'drop', 'build', 'fill', 'part', 'section', 'loop', 'main', 'alt', 'var', 'chords', 'bass', 'lead']);
const kebab = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function tokenize(str) {
  return kebab(str).split('-').filter((t) => t && t.length > 1 && !DROP.has(t) && !/^\d+$/.test(t) && !/^\d*bpm$/.test(t) && !/^add\d$/.test(t) && !/^m?a?j?\d$/.test(t));
}
export function deriveTags(entry) {
  const folders = (entry.path || '').split('/').slice(0, -1);
  // origin folder names carry the vendor's own richest genre/emotion labels
  const originFolders = (entry.origin || '').split('/').slice(0, -1);
  const raw = [...folders, ...originFolders, ...String(entry.mood || '').split(/\s+/), ...String(entry.descriptor || '').split(/\s+/)];
  const toks = new Set(raw.flatMap(tokenize));
  const genre = [...toks].filter((t) => GENRE.has(t));
  const emotion = [...toks].filter((t) => EMOTION.has(t));
  const p = entry.path || '';
  const quality = /best-/.test(p) ? 'best' : /advanced/.test(p) ? 'advanced' : /gorgeous/.test(p) ? 'best' : '';
  const tags = [...new Set([...genre, ...emotion])];
  return { genre, emotion, tags, quality };
}

// ---------- note extraction ----------
export function readMidi(absPath) {
  const midi = new Midi(fs.readFileSync(absPath));
  const ppq = midi.header.ppq;
  const ts = midi.header.timeSignatures?.[0]?.timeSignature || [4, 4];
  const pitched = [];
  let hasPercussion = false;
  for (const track of midi.tracks) {
    if (track.instrument?.percussion) { hasPercussion = hasPercussion || track.notes.length > 0; continue; }
    for (const n of track.notes) pitched.push({ midi: n.midi, ticks: n.ticks, durationTicks: n.durationTicks });
  }
  return { ppq, beats: ts[0], beatType: ts[1], pitched, hasPercussion };
}

// ---------- quantization to a divisions grid ----------
const q = (ticks, ppq) => Math.round((ticks / ppq) * DIVISIONS); // ticks -> divisions

// Greedy decomposition of a duration (in divisions) into notatable pieces,
// each { div, type, dots }. Assumes the span does not cross a barline.
const ATOMS = [
  { div: 16, type: 'whole', dots: 0 }, { div: 12, type: 'half', dots: 1 },
  { div: 8, type: 'half', dots: 0 }, { div: 6, type: 'quarter', dots: 1 },
  { div: 4, type: 'quarter', dots: 0 }, { div: 3, type: 'eighth', dots: 1 },
  { div: 2, type: 'eighth', dots: 0 }, { div: 1, type: '16th', dots: 0 },
];
function decompose(divs) {
  const out = [];
  let rem = divs;
  while (rem > 0) {
    const a = ATOMS.find((x) => x.div <= rem);
    out.push(a); rem -= a.div;
  }
  return out;
}

// ---------- build a single-voice event stream (chords = simultaneous onsets) ----------
function buildEvents(pitched, ppq) {
  // group by quantized onset
  const byOnset = new Map();
  for (const n of pitched) {
    const on = q(n.ticks, ppq);
    const dur = Math.max(1, q(n.durationTicks, ppq));
    if (!byOnset.has(on)) byOnset.set(on, { on, dur, midis: [] });
    const e = byOnset.get(on);
    e.midis.push(n.midi);
    e.dur = Math.min(e.dur, dur); // chord notated with its shortest member (simplification)
  }
  return [...byOnset.values()].sort((a, b) => a.on - b.on);
}

// ---------- MusicXML emission ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function noteXml({ midis, div, type, dots, tieStart, tieStop, isRest }) {
  if (isRest) return `      <note><rest/><duration>${div}</duration><type>${type}</type>${'<dot/>'.repeat(dots)}</note>`;
  return midis.map((m, i) => {
    const step = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'][mod12(m)];
    const alter = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0][mod12(m)];
    const octave = Math.floor(m / 12) - 1;
    const ties = `${tieStop ? '<tie type="stop"/>' : ''}${tieStart ? '<tie type="start"/>' : ''}`;
    const notations = (tieStart || tieStop) ? `<notations>${tieStop ? '<tied type="stop"/>' : ''}${tieStart ? '<tied type="start"/>' : ''}</notations>` : '';
    return `      <note>${i > 0 ? '<chord/>' : ''}<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>${ties}<duration>${div}</duration><type>${type}</type>${'<dot/>'.repeat(dots)}${notations}</note>`;
  }).join('\n');
}

// Emit one span (chord or rest) that may cross barlines: split at each barline
// with ties, then greedy-decompose each side.
function emitSpan(pos, dur, midis, measureLen, isRest) {
  const lines = [];
  let p = pos; let remaining = dur;
  let firstPiece = true;
  while (remaining > 0) {
    const intoMeasure = p % measureLen;
    const toBarline = measureLen - intoMeasure;
    const chunk = Math.min(remaining, toBarline);
    const pieces = decompose(chunk);
    pieces.forEach((pc, i) => {
      const tieStop = !isRest && !(firstPiece && i === 0);
      const tieStart = !isRest && !(remaining - pc.div <= 0 && i === pieces.length - 1);
      lines.push({ boundary: p % measureLen === 0 && !(firstPiece && i === 0), xml: noteXml({ midis, div: pc.div, type: pc.type, dots: pc.dots, tieStart, tieStop, isRest }) });
      p += pc.div; firstPiece = false;
    });
    remaining -= chunk;
  }
  return lines;
}

export function toMusicXML(events, { beats, beatType }, meta) {
  const measureLen = DIVISIONS * beats * (4 / beatType); // divisions per measure
  const end = events.length ? Math.max(...events.map((e) => e.on + e.dur)) : measureLen;
  const totalLen = Math.max(measureLen, Math.ceil(end / measureLen) * measureLen);

  // walk the timeline, filling gaps with rests
  const spanLines = [];
  let cursor = 0;
  for (const e of events) {
    if (e.on > cursor) spanLines.push(...emitSpan(cursor, e.on - cursor, [], measureLen, true));
    spanLines.push(...emitSpan(e.on, e.dur, e.midis, measureLen, false));
    cursor = Math.max(cursor, e.on + e.dur);
  }
  if (cursor < totalLen) spanLines.push(...emitSpan(cursor, totalLen - cursor, [], measureLen, true));

  // chunk lines into measures on barline boundaries
  const measures = [];
  let cur = [];
  for (const l of spanLines) {
    if (l.boundary && cur.length) { measures.push(cur); cur = []; }
    cur.push(l.xml);
  }
  if (cur.length) measures.push(cur);

  const misc = Object.entries(meta.miscellaneous)
    .map(([k, v]) => `      <miscellaneous-field name="${esc(k)}">${esc(v)}</miscellaneous-field>`).join('\n');

  const body = measures.map((mLines, i) => {
    const attrs = i === 0
      ? `      <attributes><divisions>${DIVISIONS}</divisions><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`
      : '';
    return `    <measure number="${i + 1}">\n${attrs ? attrs + '\n' : ''}${mLines.join('\n')}\n    </measure>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <identification>
    <miscellaneous>
${misc}
    </miscellaneous>
  </identification>
  <part-list><score-part id="P1"><part-name>${esc(meta.miscellaneous.type)}</part-name></score-part></part-list>
  <part id="P1">
${body}
  </part>
</score-partwise>
`;
}

// ---------- V2 bass-informed harmonic analysis (per beat, collapsed with durations) ----------
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const TRIADS_V2 = [['major', [0, 4, 7]], ['minor', [0, 3, 7]], ['diminished', [0, 3, 6]], ['augmented', [0, 4, 8]], ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]]];

function fitTriadBass(pcs, bassPc) {
  if (pcs.size < 2) return null;
  let best = null;
  for (let root = 0; root < 12; root += 1) for (const [quality, iv] of TRIADS_V2) {
    const triad = iv.map((i) => (root + i) % 12);
    const present = triad.filter((pc) => pcs.has(pc)).length;
    if (present < 2) continue;
    const extra = [...pcs].filter((pc) => !triad.includes(pc)).length;
    let s = present * 2 - extra * 0.5;
    if (bassPc != null) s += root === bassPc ? 3 : triad.includes(bassPc) ? 0.5 : -1.5;
    if (!best || s > best.s) best = { root, quality, s };
  }
  return best ? { root: best.root, quality: best.quality } : null;
}

// per-beat windows over the raw notes: { pcs, bassPc, melodyPc }
function beatWindows(notes, ppq, beats, beatType) {
  if (!notes.length) return [];
  const bt = ppq * (4 / beatType);
  const end = notes.reduce((m, n) => Math.max(m, n.ticks + (n.durationTicks || 0)), 0);
  const count = Math.max(1, Math.ceil(end / bt));
  return Array.from({ length: count }, (_, s) => {
    const t0 = s * bt; const t1 = t0 + bt;
    const sounding = notes.filter((n) => n.ticks < t1 && n.ticks + (n.durationTicks || 0) > t0);
    const onsets = sounding.filter((n) => n.ticks >= t0 && n.ticks < t1);
    const pool = onsets.length ? onsets : sounding;
    return {
      pcs: new Set(sounding.map((n) => mod12(n.midi))),
      bassPc: pool.length ? mod12(pool.reduce((lo, n) => (n.midi < lo.midi ? n : lo)).midi) : null,
      melodyPc: onsets.length ? mod12(onsets.reduce((hi, n) => (n.midi > hi.midi ? n : hi)).midi) : null,
    };
  });
}

// Collapse per-beat chords into { root, quality, beats } runs (bass = monophonic root line).
function analyzeHarmony(notes, ppq, beats, beatType, isBass) {
  const wins = beatWindows(notes, ppq, beats, beatType);
  const perBeat = wins.map((w) => (isBass
    ? (w.bassPc != null ? { root: w.bassPc, quality: 'bass' } : null)
    : fitTriadBass(w.pcs, w.bassPc)));
  const runs = [];
  for (const c of perBeat) {
    if (!c) continue;
    const last = runs[runs.length - 1];
    if (last && last.root === c.root && last.quality === c.quality) last.beats += 1;
    else runs.push({ root: c.root, quality: c.quality, beats: 1 });
  }
  const resolved = perBeat.filter(Boolean).length;
  return { runs, confidence: perBeat.length ? resolved / perBeat.length : 0, wins };
}

// ---------- canonical Roman/note-name + Braille-duration filenames ----------
// Braille = beat-occupancy mask, 1 dot = 1 beat, filled run (2 beats -> ⠃, 4 -> ⠏, 8 -> ⠿).
function brailleDur(beats) {
  let n = Math.max(1, Math.round(beats)); let out = '';
  while (n > 0) { const k = Math.min(8, n); out += String.fromCodePoint(0x2800 + ((1 << k) - 1)); n -= k; }
  return out;
}
// optional leading header glyph declares resolution+meter; absent = beat-grid 4/4.
const METER_HEADER = { '4/4': '', '3/4': '⠢', '6/8': '⠔', '2/4': '⠆', '12/8': '⠿', '5/4': '⠲' };
const headerGlyph = (beats, beatType) => (METER_HEADER[`${beats}/${beatType}`] ?? (beats === 4 && beatType === 4 ? '' : '⠮'));

function finalizeName(header, tokens, allowCycle) {
  if (!tokens.length) return null;
  let seq = allowCycle ? minimalCycle(tokens) : tokens;
  if (seq.join('-').length > 120) seq = seq.slice(0, 12); // long melodies -> lead phrase (hash disambiguates)
  return (header + seq.join('-')).replace(/[\/\\]/g, '');
}

// Returns { name, roman, signature, confidence } — name is the canonical filename stem.
function canonicalize(entry, notes, ppq, beats, beatType) {
  const header = headerGlyph(beats, beatType);
  if (entry.type === 'melody') {
    const wins = beatWindows(notes, ppq, beats, beatType);
    const runs = [];
    for (const w of wins) {
      if (w.melodyPc == null) continue;
      const last = runs[runs.length - 1];
      if (last && last.pc === w.melodyPc) last.beats += 1; else runs.push({ pc: w.melodyPc, beats: 1 });
    }
    const tokens = runs.map((r) => NOTE_NAMES[r.pc] + brailleDur(r.beats));
    return { name: finalizeName(header, tokens, false), roman: null, signature: null, confidence: runs.length ? 1 : 0 };
  }
  // chords / idea / bassline: derive roman (bass = root-line, uppercase degrees)
  const isBass = entry.type === 'bassline';
  const { runs, confidence } = analyzeHarmony(notes, ppq, beats, beatType, isBass);
  if (!runs.length) return { name: null, roman: null, signature: null, confidence };
  const tonic = bestTonic(runs);
  const roman = romanAnalysis(runs, tonic);
  const tokens = roman.map((r, i) => r + brailleDur(runs[i].beats));
  return { name: finalizeName(header, tokens, true), roman, signature: signatureKey(roman), confidence };
}

// percussion/groove: cleaned feel token (no harmony), bpm stripped
const feelName = (slug) => String(slug).replace(/-?\d+bpm/gi, '').replace(/-+$/,'') || slug;

// ---------- per-entry conversion ----------
export function convertEntry(entry, { loopsDir, nowIso }) {
  const abs = path.join(loopsDir, entry.path);
  const midi = readMidi(abs);
  const events = buildEvents(midi.pitched, midi.ppq);
  const canon = midi.pitched.length
    ? canonicalize(entry, midi.pitched, midi.ppq, midi.beats, midi.beatType)
    : { name: (entry.type === 'groove' || entry.type === 'percussion') ? feelName(entry.slug) : null, roman: null, signature: null, confidence: 0 };
  const harmony = { roman: canon.roman, signature: canon.signature, confidence: canon.confidence };
  const warnings = [];
  if (!midi.pitched.length && !midi.hasPercussion) warnings.push('no-notes');
  if (midi.pitched.length && harmony.confidence < 0.6 && entry.type === 'chord-progression') warnings.push('low-harmony-confidence');
  if (!canon.name) warnings.push('no-canonical-name');

  const { genre, emotion, tags, quality } = deriveTags(entry);
  const meta = {
    miscellaneous: {
      type: entry.type,
      'canonical-name': canon.name || '',
      title: entry.title || '',
      // --- descriptors surfaced in the UX ---
      genre: genre.join(','),
      emotion: emotion.join(','),
      tags: tags.join(','),
      quality,
      artist: entry.artist || '',
      bpm: entry.bpm != null ? String(entry.bpm) : '',
      reverb: entry.reverb || '',
      // --- raw source descriptors kept for traceability ---
      'source-mood': entry.mood || '',
      'source-descriptor': entry.descriptor || '',
      // --- provenance ---
      'source-slug': entry.slug,
      'source-midi': entry.path,
      'vendor-origin': entry.origin || '',
      'source-pack': (entry.sources || []).join(','),
      'converter-version': CONVERTER_VERSION,
      'analyzer-version': ANALYZER_VERSION,
      'converted-at': nowIso,
      'derived-roman': (harmony.roman || []).join(' '),
      'derived-signature': harmony.signature || '',
      'derived-confidence': harmony.confidence.toFixed(2),
    },
  };
  const xml = midi.pitched.length ? toMusicXML(events, midi, meta) : toMusicXML([], midi, meta);
  const ledger = {
    slug: entry.slug, canonical: canon.name, type: entry.type, source: entry.path,
    genre, emotion, tags, quality, artist: entry.artist || null,
    ppq: midi.ppq, notes: midi.pitched.length, hasPercussion: midi.hasPercussion,
    derivedRoman: harmony.roman, derivedSignature: harmony.signature,
    derivedConfidence: harmony.confidence, converter: CONVERTER_VERSION, analyzer: ANALYZER_VERSION,
    convertedAt: nowIso, warnings,
  };
  return { xml, ledger, canonicalName: canon.name };
}

// ---------- CLI batch ----------
function main() {
  // New layout: canonical MusicXML asset folders live at media/midi root; the
  // source packs, the old .mid tree, backups and the ledger live under _workspace.
  const ROOT = process.env.MIDI_ROOT || '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/media/midi';
  const WORKSPACE = path.join(ROOT, '_workspace');
  const LOOPS = process.env.LOOPS_DIR || path.join(WORKSPACE, 'loops-midi');
  const OUT = process.env.OUT_DIR || ROOT; // type folders (chords/, melodies/, …) at root
  const args = process.argv.slice(2);
  const sampleMode = args.includes('--sample');
  const index = yaml.load(fs.readFileSync(path.join(LOOPS, 'index.yml'), 'utf8'));
  const nowIso = new Date().toISOString();

  let entries = index;
  if (sampleMode) {
    // one representative per type
    const byType = {};
    for (const e of index) if (!byType[e.type]) byType[e.type] = e;
    entries = Object.values(byType);
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(WORKSPACE, { recursive: true });
  const ledgerPath = path.join(WORKSPACE, '_ledger.jsonl');
  const ledgerRows = [];
  let ok = 0; let failed = 0;
  const typeDir = (t) => ({ 'chord-progression': 'chords', bassline: 'basslines', melody: 'melodies', idea: 'ideas', groove: 'percussion', percussion: 'percussion' }[t] || t);
  const hash6 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 6);

  // pass 1: convert everything, compute canonical names (Roman/note-name + Braille).
  const converted = [];
  for (const entry of entries) {
    try {
      const r = convertEntry(entry, { loopsDir: LOOPS, nowIso });
      converted.push({ entry, ...r });
    } catch (err) {
      ledgerRows.push({ slug: entry.slug, source: entry.path, status: 'FAILED', error: String(err.message || err), convertedAt: nowIso });
      failed += 1;
    }
  }

  // pass 2: canonical names are intentionally many-to-one (same progression+rhythm
  // in different voicings). Disambiguate ALL members of a collided name with a
  // source-path hash so the mapping stays 1 input -> 1 output and traceable.
  // NB: fold case in the collision key — macOS/APFS is case-insensitive, but Roman
  // case (III vs iii) is the major/minor signal, so case-twins must be disambiguated.
  const nameKey = (type, base) => `${typeDir(type)}/${base}`.toLowerCase();
  const nameCounts = new Map();
  for (const c of converted) {
    const k = nameKey(c.entry.type, c.canonicalName || c.entry.slug);
    nameCounts.set(k, (nameCounts.get(k) || 0) + 1);
  }

  for (const { entry, xml, ledger, canonicalName } of converted) {
    const dir = path.join(OUT, typeDir(entry.type));
    fs.mkdirSync(dir, { recursive: true });
    const base = canonicalName || entry.slug;
    const collided = nameCounts.get(nameKey(entry.type, base)) > 1;
    const fname = collided ? `${base}-${hash6(entry.path)}` : base;
    const outPath = path.join(dir, `${fname}.musicxml`);
    fs.writeFileSync(outPath, xml);
    ledger.output = path.relative(OUT, outPath);
    ledger.disambiguated = collided;
    ledgerRows.push(ledger); ok += 1;
  }
  fs.writeFileSync(ledgerPath, ledgerRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`${sampleMode ? 'SAMPLE' : 'FULL'} conversion -> ${OUT}`);
  console.log(`ok=${ok} failed=${failed}  ledger: ${ledgerPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
