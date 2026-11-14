#!/usr/bin/env node
/**
 * chord-staff-replay — replay REAL playing through the live chord staff and measure it.
 *
 * The unit tests pin the column rules on synthetic gestures. This harness asks the
 * question those cannot: on what people actually played, does a chord stay one chord?
 * It replays two corpora through the exact CurrentChordStaff pipeline — one MIDI event
 * per render, diffNoteSurface → pushOnsets / pushReleases, an 80ms clearIfIdle tick —
 * and reports:
 *
 *   - chord clusters kept whole: ground-truth clusters (>= 2 notes, each onset within
 *     150ms of the previous, no cluster note released) whose onsets all landed in ONE
 *     drawn column. Baseline before the gesture rule: 68.3%.
 *   - % of drawn columns that are eighths (baseline 49.9% — chord fragments drew as
 *     beamed rhythm).
 *   - fragments: an eighth column followed within 150ms by another column.
 *   - RH-on-bass: columns entirely >= C4 that splitByHand put (partly) on the bass
 *     staff (baseline 234).
 *   - rolled columns: at least one staff whose own arrivals span >= ROLL_MARK_MS
 *     with 2+ notes on it, so it draws an arpeggio stroke (noteFlow staffRoll).
 *   - far-crossed (informational): columns with a treble note below G3 or a bass
 *     note above E4 — what hand-reach shedding does to a wide cluster.
 *   - held-chord whole % (informational): the same whole test on 3+ note clusters
 *     whose keys all stay down 150ms past the last onset, i.e. without legato runs.
 *   - why each split cluster split (gap from last onset, span cap, released key,
 *     re-strike, note cap, legato release split) — the first thing to read if the
 *     gate fails.
 *   - legato merged: of the LEGATO PAIRS in the raw stream (successive onsets >= 30ms
 *     apart, the first key let go within 150ms after the second lands), the share the
 *     staff drew in ONE column — a legato line drawn as a chord (lower is better).
 *   - chord whole %: the whole test on clusters with no legato pair in them — the
 *     chords the release split must leave whole. The gate reads this, not whole %: the
 *     loose cluster rule also collects every overlapping legato step, so whole % pays
 *     for each legato line the staff correctly draws as separate notes.
 *
 * Exit 1 when chord whole % < 90 or RH-on-bass > 0 (overall, both corpora).
 *
 * Corpora:
 *   studio  ${DAYLIGHT_DATA_PATH}/users/<user>/apps/piano/studio/*.yml
 *           (YAML events [{t, type, note, velocity}]); takes under 20 onsets skipped.
 *   capture <media>/midi/piano/log/<user>/<YYYY-MM-DD>/<HH.MM.SS>.mid, the always-on
 *           capture history. Media root: --media, else DAYLIGHT_MEDIA_PATH, else
 *           dirname(DAYLIGHT_DATA_PATH)/media. `jamcorder` (raw device dumps) is
 *           skipped unless named in --users.
 * Both: same-type same-note events <= 10ms apart are dropped (one 2026-08-09 take has
 * every event doubled by two feeds); velocity-0 note-on is a note-off.
 *
 *   node tests/_infrastructure/harnesses/chord-staff-replay.mjs
 *     [--users a,b] [--limit N]        captures per user, newest first (default 60)
 *     [--since YYYY-MM-DD]             captures and studio takes on/after this date
 *     [--media <dir>] [--data <dir>]
 *     [--render <outDir>]              screenshot chosen moments + index.html + moments.json
 *     [--moments <moments.json>]       with --render: re-render the SAME moments a previous
 *                                      run chose (replayed through the current code, matched
 *                                      by event index) — for before/after comparisons
 *     [--sweep-gap]                    replay the corpus under every GAP_MS x LEGATO_RELEASE_MS
 *                                      pair (passed as pushOnsets/pushReleases opts, the module
 *                                      untouched) and print whole-chord % vs legato merged %
 *
 * --render picks, per user: up to 2 moments with a rolled column on screen, 1 fast
 * run (>= 4 eighth columns), 1 two-hand column, 1 densest screen; plus the 10 worst
 * "fragment" moments overall. Each is drawn by renderChordStaff at aspect 2.8 (the
 * Studio pane) in Playwright at 1120x400, bundled against frontend/node_modules like
 * chord-staff-ink-sweep.mjs. Spelling is buildRenderColumns (identifyChord, every column
 * in the current key) and the key is useDetectedKey's rule replayed outside React:
 * detectKey over the pitch classes of newly pressed keys, last 30 within 10s.
 *
 * Read-only on the data and media volumes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  emptyFlow, pushOnsets, pushReleases, clearIfIdle, flowDurations, columnRolls,
  GAP_MS, SPAN_MAX_MS, MAX_COLUMN_NOTES, ROLL_MARK_MS, LEGATO_RELEASE_MS, LEGATO_MIN_STEP_MS,
} from '../../../__capabilities/music-notation/browser/model/noteFlow.js';
import { splitByHand } from '../../../__capabilities/music-notation/browser/model/handSplit.js';
import { detectKey } from '../../../__capabilities/music-notation/browser/model/keySignature.js';
import { diffNoteSurface, buildRenderColumns } from '../../../__app_modules/learning/piano/browser/components/liveStaffColumns.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const { parseMidi } = require('midi-file');

const TICK_MS = 80;            // CurrentChordStaff PROVISIONAL_TICK_MS
const CLUSTER_GAP_MS = 150;    // ground truth: successive onsets of one held cluster
const STRUCK_MS = 30;          // ground truth: onsets closer than this were struck together
const LEGATO_OVERLAP_MS = 150; // ground truth: a key let go this soon after the next lands is legato
const DUP_MS = 10;             // doubled-feed duplicates
const MIN_ONSETS = 20;
const KEY_BUFFER_MAX_AGE = 10_000; // useDetectedKey
const KEY_BUFFER_MAX_NOTES = 30;
const ASPECT = 2.8;
const VIEW = { width: 1120, height: 400 };

// ─── args ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = { users: null, limit: 60, since: null, media: null, data: null, render: null, moments: null, sweepGap: false };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i]; const v = argv[i + 1];
    if (k === '--users') { a.users = v.split(',').map((s) => s.trim()).filter(Boolean); i += 1; }
    else if (k === '--limit') { a.limit = Number(v); i += 1; }
    else if (k === '--since') { a.since = v; i += 1; }
    else if (k === '--media') { a.media = v; i += 1; }
    else if (k === '--data') { a.data = v; i += 1; }
    else if (k === '--render') { a.render = v; i += 1; }
    else if (k === '--moments') { a.moments = v; i += 1; }
    else if (k === '--sweep-gap') { a.sweepGap = true; }
    else if (k === '--help' || k === '-h') { a.help = true; }
    else throw new Error(`unknown flag ${k}`);
  }
  return a;
}

// ─── loading ─────────────────────────────────────────────────────────────────

/** Sort, normalise to {t, type:'on'|'off', note}, drop doubled-feed duplicates. */
function normalise(raw) {
  const out = [];
  const lastOn = new Map(); const lastOff = new Map();
  for (const e of raw.sort((x, y) => x.t - y.t)) {
    const seen = e.type === 'on' ? lastOn : lastOff;
    if (seen.has(e.note) && e.t - seen.get(e.note) <= DUP_MS) continue;
    seen.set(e.note, e.t);
    out.push(e);
  }
  return out;
}

function loadStudio(file) {
  const doc = yaml.load(fs.readFileSync(file, 'utf8')) || {};
  const raw = (doc.events || [])
    .filter((e) => e && Number.isFinite(e.t) && Number.isFinite(e.note))
    .map((e) => ({ t: e.t, note: e.note, type: e.type === 'note_on' && (e.velocity ?? 1) > 0 ? 'on' : 'off' }));
  return { created: doc.created ? String(doc.created).slice(0, 10) : null, events: normalise(raw) };
}

/** A .mid file as absolute-ms events: every track merged, tempo map respected. */
function loadMidi(file) {
  const midi = parseMidi(fs.readFileSync(file));
  const tpb = midi.header.ticksPerBeat || 480;
  const all = [];
  for (const track of midi.tracks) {
    let tick = 0;
    for (const e of track) { tick += e.deltaTime; all.push({ tick, e }); }
  }
  all.sort((a, b) => a.tick - b.tick);
  let usPerBeat = 500000; let lastTick = 0; let ms = 0;
  const raw = [];
  for (const { tick, e } of all) {
    ms += ((tick - lastTick) * usPerBeat) / tpb / 1000;
    lastTick = tick;
    if (e.type === 'setTempo') usPerBeat = e.microsecondsPerBeat;
    else if (e.type === 'noteOn') raw.push({ t: ms, note: e.noteNumber, type: e.velocity > 0 ? 'on' : 'off' });
    else if (e.type === 'noteOff') raw.push({ t: ms, note: e.noteNumber, type: 'off' });
  }
  return { events: normalise(raw) };
}

function listStudio(dataDir, users, since) {
  const root = path.join(dataDir, 'users');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).sort()
    .filter((u) => (users ? users.includes(u) : true))
    .flatMap((u) => {
      const d = path.join(root, u, 'apps/piano/studio');
      if (!fs.existsSync(d)) return [];
      return fs.readdirSync(d).filter((f) => f.endsWith('.yml')).sort()
        .map((f) => ({ source: 'studio', user: u, file: path.join(d, f), since }));
    });
}

function listCaptures(mediaDir, users, limit, since) {
  const root = path.join(mediaDir, 'midi/piano/log');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).sort()
    .filter((u) => (users ? users.includes(u) : u !== 'jamcorder'))
    .flatMap((u) => {
      const files = [];
      const ud = path.join(root, u);
      for (const day of fs.readdirSync(ud)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || (since && day < since)) continue;
        for (const f of fs.readdirSync(path.join(ud, day))) {
          if (f.endsWith('.mid')) files.push({ key: `${day} ${f}`, file: path.join(ud, day, f) });
        }
      }
      files.sort((a, b) => (a.key < b.key ? 1 : -1));
      return files.slice(0, limit).map((x) => ({ source: 'capture', user: u, file: x.file }));
    });
}

// ─── ground truth ────────────────────────────────────────────────────────────

/**
 * A LEGATO PAIR: two successive onsets where the first key was still down when the
 * second landed, landed at least STRUCK_MS before it (not one strike), and let go
 * within LEGATO_OVERLAP_MS after it. Struck chords are excluded on purpose: a chord
 * struck in 10ms and released 50ms later meets the release test too, and on this
 * corpus such short struck chords outnumber every legato step.
 */
function isLegatoPair(events, ia, ib, offsAfter) {
  const a = events[ia]; const b = events[ib];
  if (a.note === b.note || b.t - a.t < STRUCK_MS || b.t - a.t > CLUSTER_GAP_MS) return false;
  const off = offsAfter(a.note, a.t);
  return !!off && off.t >= b.t && off.t < b.t + LEGATO_OVERLAP_MS;
}

/**
 * Chord clusters straight from the raw stream: an onset joins the open cluster when
 * it lands within CLUSTER_GAP_MS of the previous onset and every cluster note is still
 * down. Deliberately looser than the model (no span cap, no note cap, 150 not 90), so
 * what the model splits shows up as a loss. Same definition that produced the 68.3%
 * baseline (spec §1).
 */
function clustersOf(events) {
  const held = new Set();
  const out = []; let cur = null;
  const releases = [];
  events.forEach((e, i) => {
    if (e.type === 'off') { held.delete(e.note); releases.push(e); return; }
    const joins = cur && e.t - cur.lastT <= CLUSTER_GAP_MS && cur.notes.every((n) => held.has(n));
    if (joins) { cur.notes.push(e.note); cur.idx.push(i); cur.lastT = e.t; }
    else { cur = { startT: e.t, lastT: e.t, notes: [e.note], idx: [i] }; out.push(cur); }
    held.add(e.note);
  });
  // HELD CHORD: 3+ notes, every one still down CLUSTER_GAP_MS past the last onset.
  // That excludes legato runs (each key lets go as the next lands), which the loose
  // cluster rule above also collects; it is the population the spec's span numbers
  // (p95 244ms, 95.6% within 250ms) were measured on.
  const offsByNote = new Map();
  for (const r of releases) (offsByNote.get(r.note) || offsByNote.set(r.note, []).get(r.note)).push(r);
  const offsAfter = (note, t) => (offsByNote.get(note) || []).find((r) => r.t >= t);
  // Every legato pair in the take, clustered or not: "legato merged" asks how many of
  // them the staff drew in one column.
  const onIdx = events.map((e, i) => (e.type === 'on' ? i : -1)).filter((i) => i >= 0);
  const legatoPairs = [];
  for (let k = 1; k < onIdx.length; k += 1) {
    if (isLegatoPair(events, onIdx[k - 1], onIdx[k], offsAfter)) legatoPairs.push([onIdx[k - 1], onIdx[k]]);
  }
  const clusters = out.filter((c) => c.notes.length >= 2).map((c) => ({
    ...c,
    // LEGATO LINE: some note let go within LEGATO_OVERLAP_MS of the next onset, and that
    // next onset was not struck with it (>= STRUCK_MS later). Model-independent, so the
    // sweep can judge every LEGATO_RELEASE_MS against the same truth.
    legatoLine: c.notes.some((n, k) => k < c.notes.length - 1 && isLegatoPair(events, c.idx[k], c.idx[k + 1], offsAfter)),
    heldChord: c.notes.length >= 3 && c.notes.every((n, k) => {
      const off = offsAfter(n, events[c.idx[k]].t);
      return !off || off.t >= c.lastT + CLUSTER_GAP_MS;
    }),
  }));
  return { clusters, legatoPairs };
}

// ─── replay ──────────────────────────────────────────────────────────────────

/** Why a batch did NOT join the open column — the same tests pushOnsets makes, in order. */
function splitCause(open, sorted, at, held, gapMs) {
  if (!open) return 'no-open';
  if (at - open.lastOnsetAt > gapMs) return 'gap';
  if (at - open.startedAt > SPAN_MAX_MS) return 'span';
  if (!open.midis.every((m) => held.has(m))) return 'released';
  if (sorted.some((m) => open.midis.includes(m))) return 'restrike';
  if (open.midis.length + sorted.length > MAX_COLUMN_NOTES) return 'cap';
  return 'joined';
}

/**
 * One take through CurrentChordStaff's pipeline, one event per render.
 * `onFrame(state)` (optional) sees the screen after every event.
 *
 * @returns {{ onsetColumn: Map<number, number>, onsetCause: Map<number, string>, columns: Map<number, object> }}
 */
function replay(events, onFrame, rules = {}) {
  const { gapMs = GAP_MS, legatoReleaseMs = LEGATO_RELEASE_MS, ...extra } = rules;
  let flow = emptyFlow();
  let active = new Map();
  let prev = new Map();
  let nextTick = TICK_MS;
  let serial = 0;
  const onsetColumn = new Map();  // event index -> column serial
  const onsetCause = new Map();   // event index -> why it opened a new column
  const columns = new Map();      // serial -> last seen column
  const onsetsOf = new Map();     // serial -> [{note, t}]
  const eventOf = new Map();      // 'note@at' -> event index of that note-on
  const legatoSteps = [];         // ms between the halves of every legato split
  // useDetectedKey, outside React: new keys (by presence) feed the rolling buffer.
  let key = 'C'; let lastKeys = new Set(); let keyBuf = [];

  // Every column gets a serial. A column with none is new from an onset; one that
  // repeats its left neighbour's serial is the second half of a legato split, which
  // pushReleases makes by copying the column it split.
  const tag = () => {
    let changed = false;
    const cols = flow.columns.map((c, k) => {
      const prevCol = flow.columns[k - 1];
      if (c._id !== undefined && !(prevCol && prevCol._id === c._id)) return c;
      changed = true;
      serial += 1;
      if (c._id !== undefined) {
        // Split: the first onset of this half now opens a column, by release.
        const first = eventOf.get(`${c.arrivals[0].midi}@${c.arrivals[0].at}`);
        if (first !== undefined) onsetCause.set(first, 'legato');
        legatoSteps.push(c.startedAt - prevCol.lastOnsetAt);
      }
      return { ...c, _id: serial };
    });
    if (changed) flow = { ...flow, columns: cols };
    for (const c of flow.columns) {
      for (const a of c.arrivals) {
        const idx = eventOf.get(`${a.midi}@${a.at}`);
        if (idx !== undefined) onsetColumn.set(idx, c._id);
      }
      onsetsOf.set(c._id, c.arrivals.map((a) => ({ note: a.midi, t: a.at })));
    }
  };

  events.forEach((e, i) => {
    while (nextTick <= e.t) { flow = clearIfIdle(flow, nextTick); nextTick += TICK_MS; }
    active = new Map(active);
    if (e.type === 'on') active.set(e.note, { timestamp: e.t });
    else active.delete(e.note);

    const { onsets, at, released, next } = diffNoteSurface(prev, active, e.t);
    prev = next;

    const curKeys = new Set(active.keys());
    const fresh = [...curKeys].filter((k) => !lastKeys.has(k));
    lastKeys = curKeys;
    if (fresh.length) {
      fresh.forEach((n) => keyBuf.push({ pc: n % 12, t: e.t }));
      keyBuf = keyBuf.filter((x) => e.t - x.t < KEY_BUFFER_MAX_AGE).slice(-KEY_BUFFER_MAX_NOTES);
      key = detectKey(keyBuf.map((x) => x.pc), key);
    }

    if (!onsets.length && !released) return;
    if (onsets.length) {
      const open = flow.columns[flow.columns.length - 1];
      const sorted = [...new Set(onsets)].sort((a, b) => a - b);
      const cause = flow.columns.length && at - flow.lastOnsetAt > 3000 ? 'idle' : splitCause(open, sorted, at, active, gapMs);
      if (e.type === 'on') eventOf.set(`${e.note}@${at}`, i);
      flow = pushOnsets(flow, onsets, at, { held: active, gapMs });
      tag();
      if (e.type === 'on' && cause !== 'joined') onsetCause.set(i, cause);
    }
    flow = pushReleases(flow, e.t, active, { legatoReleaseMs, ...extra });
    tag();
    for (const c of flow.columns) columns.set(c._id, c);
    if (onFrame) onFrame({ t: e.t, flow, key, onsetsOf, eventIndex: i });
  });
  return { onsetColumn, onsetCause, columns, legatoSteps };
}

// ─── metrics ─────────────────────────────────────────────────────────────────

const blank = () => ({
  takes: 0, onsets: 0, clusters: 0, whole: 0, causes: {}, gaps: {}, heldCauses: {},
  heldChords: 0, heldWhole: 0, chords: 0, chordWhole: 0, legatoPairs: 0, legatoMerged: 0, legatoSteps: {},
  cols: 0, eighths: 0, frags: 0, rhOnBass: 0, rolled: 0, crossed: 0,
});

function measure(events, rules) {
  const m = blank();
  const ons = events.filter((e) => e.type === 'on');
  m.takes = 1; m.onsets = ons.length;
  const { onsetColumn, onsetCause, columns, legatoSteps } = replay(events, null, rules);
  for (const g of legatoSteps) {
    const b = g < 30 ? '<30' : g <= 60 ? '30-60' : g <= 90 ? '61-90' : '>90';
    m.legatoSteps[b] = (m.legatoSteps[b] || 0) + 1;
  }

  const { clusters, legatoPairs } = clustersOf(events);
  m.legatoPairs += legatoPairs.length;
  m.legatoMerged += legatoPairs.filter(([a, b]) => onsetColumn.get(a) === onsetColumn.get(b)).length;
  for (const c of clusters) {
    m.clusters += 1;
    if (c.heldChord) m.heldChords += 1;
    if (!c.legatoLine) m.chords += 1;
    const ids = new Set(c.idx.map((i) => onsetColumn.get(i)));
    if (ids.size === 1) {
      m.whole += 1;
      if (c.heldChord) m.heldWhole += 1;
      if (!c.legatoLine) m.chordWhole += 1;
      continue;
    }
    // First onset inside the cluster that opened a new column: that is the split.
    const k = c.idx.findIndex((i, j) => j > 0 && onsetCause.has(i));
    const cause = k < 0 ? 'unknown' : onsetCause.get(c.idx[k]);
    m.causes[cause] = (m.causes[cause] || 0) + 1;
    if (c.heldChord) m.heldCauses[cause] = (m.heldCauses[cause] || 0) + 1;
    if (cause === 'gap') {
      // The silence that split it, bucketed: 91-110 is a slow roll's tail, 131-150
      // is as fast as a run gets — the ground truth's 150 cannot tell them apart.
      const g = events[c.idx[k]].t - events[c.idx[k - 1]].t;
      const b = g <= 110 ? '91-110' : g <= 130 ? '111-130' : '131-150';
      m.gaps[b] = (m.gaps[b] || 0) + 1;
    }
  }

  const cols = [...columns.values()].sort((a, b) => a.startedAt - b.startedAt);
  // Rolled = at least one staff draws a stroke, judged as the renderer judges it.
  const strokesOf = (c) => Object.values(columnRolls(c));
  cols.forEach((c, i) => {
    m.cols += 1;
    const d = c.duration ?? 'q';
    if (d === '8') {
      m.eighths += 1;
      const nx = cols[i + 1];
      if (nx && nx.startedAt - c.startedAt <= CLUSTER_GAP_MS) m.frags += 1;
    }
    if (strokesOf(c).some(Boolean)) m.rolled += 1;
    const { bassNotes, trebleNotes } = splitByHand([...c.midis].sort((a, b) => a - b));
    if (c.midis.every((n) => n >= 60) && bassNotes.length) m.rhOnBass += 1;
    // Informational, not gated: a note pushed well across the pivot by hand-reach
    // shedding — a treble note below G3 or a bass note above E4 hangs under/over its
    // staff on two or more ledger lines.
    if (trebleNotes.some((n) => n < 55) || bassNotes.some((n) => n > 64)) m.crossed += 1;
  });
  return m;
}

function add(into, m) {
  for (const k of Object.keys(m)) {
    if (k === 'causes' || k === 'gaps' || k === 'heldCauses' || k === 'legatoSteps') for (const [c, n] of Object.entries(m[k])) into[k][c] = (into[k][c] || 0) + n;
    else into[k] += m[k];
  }
}

const pct = (n, d) => (d ? (100 * n / d).toFixed(1) : '—');
function row(label, m) {
  const causes = Object.entries(m.causes).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', ');
  return {
    '': label, takes: m.takes, onsets: m.onsets, clusters: m.clusters,
    'whole %': pct(m.whole, m.clusters), 'held-chord whole %': `${pct(m.heldWhole, m.heldChords)} of ${m.heldChords}`,
    'chord whole %': pct(m.chordWhole, m.chords), 'legato merged %': `${pct(m.legatoMerged, m.legatoPairs)} of ${m.legatoPairs}`,
    cols: m.cols, 'eighth %': pct(m.eighths, m.cols),
    frags: m.frags, rolled: m.rolled, 'RH-on-bass': m.rhOnBass, 'far-crossed': m.crossed, 'split causes': causes,
  };
}

// ─── render: moment selection ────────────────────────────────────────────────

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const nn = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

/** What one frame shows, if it were drawn now: the last `slots` columns. */
function snapshot(frame, slots) {
  const durations = flowDurations(frame.flow, frame.t);
  const render = buildRenderColumns(frame.flow, durations, frame.key);
  const shown = frame.flow.columns.slice(-slots);
  const off = frame.flow.columns.length - shown.length;
  return {
    t: frame.t,
    eventIndex: frame.eventIndex,
    key: frame.key,
    columns: render.slice(off).map((c, i) => {
      const col = shown[i];
      const hits = (frame.onsetsOf.get(col._id) || []).slice().sort((a, b) => a.t - b.t);
      return {
        midis: c.midis,
        spelling: c.spelling ? [...c.spelling.entries()] : null,
        duration: c.duration,
        arrivals: c.arrivals,
        roll: (() => {
          const { treble: t, bass: b } = columnRolls(c);
          return t || b ? `${t ? `T${t}` : ''}${b ? `${t ? '/' : ''}B${b}` : ''}` : null;
        })(),
        startedAt: col.startedAt,
        raw: hits.map((h) => `${nn(h.note)}+${Math.round(h.t - col.startedAt)}`),
        hands: splitByHand([...c.midis].sort((a, b) => a - b)),
      };
    }),
  };
}

/** Scores of one screen for each kind of moment worth looking at. */
function scoreScreen(cols) {
  const rolled = cols.filter((c) => c.roll).length;
  const eighths = cols.filter((c) => c.duration === '8').length;
  const twoHand = cols.some((c) => c.hands.bassNotes.length && c.hands.trebleNotes.length) ? 1 : 0;
  const dense = cols.reduce((s, c) => s + c.midis.length, 0);
  let frag = 0;
  cols.forEach((c, i) => {
    const nx = cols[i + 1];
    if (c.duration === '8' && nx && nx.startedAt - c.startedAt <= CLUSTER_GAP_MS) frag += 1;
  });
  return { rolled, run: eighths >= 4 ? eighths : 0, twoHand: twoHand ? dense : 0, dense, frag };
}

/**
 * Per take, the best frame for each kind. Taken from a full replay with a frame
 * callback; only the column metadata is scored, the snapshot (spelling) is built for
 * winners only — but spelling CACHE state must evolve as the kiosk's would, so every
 * frame calls buildRenderColumns via snapshot() when anything is on screen.
 */
function candidatesFor(take, slots) {
  const best = {};
  let lastSig = '';
  replay(take.events, (frame) => {
    if (!frame.flow.columns.length) return;
    const snap = snapshot(frame, slots);
    const sig = snap.columns.map((c) => `${c.midis.join('.')}${c.duration}${c.roll || ''}`).join('|');
    if (sig === lastSig) return;
    lastSig = sig;
    const s = scoreScreen(snap.columns);
    for (const [kind, score] of Object.entries(s)) {
      if (!score) continue;
      // Prefer FULL screens: a moment with the window filled shows the context.
      const value = score * 100 + snap.columns.length;
      if (!best[kind] || value > best[kind].value) best[kind] = { value, snap };
    }
  });
  return best;
}

// ─── render: drawing ─────────────────────────────────────────────────────────

async function openRenderer() {
  const { chromium } = await import('playwright');
  const { build } = await import('esbuild');
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-replay-'));
  fs.writeFileSync(path.join(dir, 'entry.js'), `
import { renderChordStaff, computeChordStaffLayout } from '${REPO}/__capabilities/music-notation/browser/renderers/chordStaff.js';
window.renderChordStaff = renderChordStaff;
window.computeChordStaffLayout = computeChordStaffLayout;
`);
  await build({
    entryPoints: [path.join(dir, 'entry.js')], bundle: true, format: 'iife',
    outfile: path.join(dir, 'bundle.js'), nodePaths: [path.join(REPO, 'frontend/node_modules')], logLevel: 'warning',
  });
  fs.writeFileSync(path.join(dir, 'page.html'), `<!doctype html><html><body style="margin:0;background:#fff">
<div id="host" class="chord-staff" style="position:relative;width:${VIEW.width}px;height:${VIEW.height}px"></div>
<style>#host svg{position:absolute;inset:0;width:100%;height:100%}</style>
<script src="bundle.js"></script></body></html>`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEW });
  await page.goto(`file://${path.join(dir, 'page.html')}`);
  await page.waitForFunction(() => !!window.renderChordStaff);
  // How many columns the Studio pane draws — renderChordStaff's own slot rule.
  const slots = await page.evaluate((aspect) => {
    const { staveW } = window.computeChordStaffLayout(aspect);
    return Math.max(1, Math.min(8, Math.floor((staveW - (44 + 7 * 10) - 14) / 70)));
  }, ASPECT);
  return {
    slots,
    async draw(snap, outFile) {
      await page.evaluate(({ snap, aspect }) => {
        const host = document.getElementById('host');
        window.renderChordStaff(host, {
          columns: snap.columns.map((c) => ({
            midis: c.midis, duration: c.duration, arrivals: c.arrivals,
            spelling: c.spelling ? new Map(c.spelling) : null,
          })),
          keySignature: snap.key,
          aspect,
        });
      }, { snap, aspect: ASPECT });
      await page.locator('#host').screenshot({ path: outFile });
    },
    async close() { await browser.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;

/**
 * Choose the moments. Deterministic for a given set of takes: takes are listed in
 * sorted order and ties break on file then event index, so the same corpus always
 * yields the same picks under the same names.
 */
function selectMoments(takes, slots) {
  const perUser = {};
  const frags = [];
  for (const take of takes) {
    const best = candidatesFor(take, slots);
    const u = (perUser[take.user] ||= { rolled: [], run: [], twoHand: [], dense: [] });
    for (const kind of Object.keys(u)) if (best[kind]) u[kind].push({ take, ...best[kind] });
    if (best.frag) frags.push({ take, ...best.frag });
  }
  const picks = [];
  const used = new Set();
  const pick = (list, n, user, kind) => {
    // Ties (common: scores saturate) go to studio takes first, then by user, then the
    // NEWEST capture, then the earliest moment in the take.
    const rank = (c) => (c.take.source === 'studio' ? 0 : 1);
    list.sort((a, b) => b.value - a.value
      || rank(a) - rank(b)
      || (a.take.user < b.take.user ? -1 : a.take.user > b.take.user ? 1 : 0)
      || (rank(a) === 0
        ? (a.take.file < b.take.file ? -1 : a.take.file > b.take.file ? 1 : 0)
        : (a.take.file < b.take.file ? 1 : a.take.file > b.take.file ? -1 : 0))
      || a.snap.eventIndex - b.snap.eventIndex);
    let taken = 0;
    for (const c of list) {
      if (taken >= n) break;
      const id = `${c.take.file}@${c.snap.t}`;
      if (used.has(id)) continue;
      used.add(id); taken += 1;
      picks.push({ user, kind, take: c.take, snap: c.snap });
    }
  };
  for (const [user, k] of Object.entries(perUser).sort()) {
    pick(k.rolled, 2, user, 'rolled');
    pick(k.run, 1, user, 'run');
    pick(k.twoHand, 1, user, 'two-hand');
    pick(k.dense, 1, user, 'dense');
  }
  pick(frags, 10, null, 'fragment');
  return picks.map((p, n) => {
    const user = p.user ?? p.take.user;
    return { ...p, user, name: `${String(n + 1).padStart(2, '0')}-${user}-${p.kind}.png` };
  });
}

/**
 * Re-find moments from a moments.json written by an earlier --render: each take is
 * replayed through the CURRENT code and snapshotted at the same event index, so a
 * later change to the model or renderer can be compared on exactly the same playing.
 * The index is stable because loading/normalising does not depend on the model.
 */
function momentsFromManifest(file, slots) {
  const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cache = new Map();
  return entries.map((m) => {
    if (!cache.has(m.file)) {
      const take = m.source === 'studio' ? loadStudio(m.file) : loadMidi(m.file);
      cache.set(m.file, { source: m.source, user: m.takeUser, file: m.file, events: take.events });
    }
    const take = cache.get(m.file);
    let snap = null;
    replay(take.events, (frame) => {
      const s = frame.flow.columns.length ? snapshot(frame, slots) : null;
      if (frame.eventIndex === m.eventIndex) snap = s;
    });
    if (!snap) throw new Error(`moment ${m.name}: event ${m.eventIndex} of ${m.file} shows nothing`);
    return { name: m.name, user: m.user, kind: m.kind, take, snap };
  });
}

async function renderMoments(outDir, takes, manifest) {
  const r = await openRenderer();
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const picks = manifest ? momentsFromManifest(manifest, r.slots) : selectMoments(takes, r.slots);
    fs.writeFileSync(path.join(outDir, 'moments.json'), `${JSON.stringify(picks.map((p) => ({
      name: p.name, user: p.user, kind: p.kind, source: p.take.source, takeUser: p.take.user,
      file: p.take.file, eventIndex: p.snap.eventIndex, t: p.snap.t,
    })), null, 2)}\n`);

    const cards = [];
    for (const p of picks) {
      const { user, name } = p;
      await r.draw(p.snap, path.join(outDir, name));
      const rel = p.take.source === 'capture'
        ? p.take.file.split('/').slice(-3).join('/')
        : `studio/${path.basename(p.take.file)}`;
      const cols = p.snap.columns.map((c, i) => {
        const prevStart = i ? p.snap.columns[i - 1].startedAt : null;
        const gap = prevStart === null ? '' : ` <span class="gap">+${Math.round(c.startedAt - prevStart)}ms</span>`;
        return `<li>${gap} <b>${esc(c.duration)}${c.roll ? ` roll-${c.roll}` : ''}</b> ${esc(c.raw.join(' '))}
          <span class="hands">bass[${c.hands.bassNotes.map(nn).join(' ')}] treble[${c.hands.trebleNotes.map(nn).join(' ')}]</span></li>`;
      }).join('');
      cards.push(`<figure><img src="${name}" alt="${esc(name)}"><figcaption>
        <b>${esc(name)}</b> — ${esc(user)} · ${esc(p.take.source)} · ${esc(rel)} · at ${clock(p.snap.t)} · key ${esc(p.snap.key)}
        <ol>${cols}</ol></figcaption></figure>`);
    }
    fs.writeFileSync(path.join(outDir, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Chord staff replay</title>
<style>body{font:14px system-ui,sans-serif;margin:16px;background:#f4f4f2;color:#1a1a1a}
figure{background:#fff;margin:0 0 24px;padding:12px;border:1px solid #ccc;max-width:1120px}
img{width:100%;height:auto;display:block;border-bottom:1px solid #eee}
ol{margin:6px 0 0;padding-left:22px;font-family:ui-monospace,monospace;font-size:12px}
.gap{color:#777}.hands{color:#557;margin-left:8px}</style></head><body>
<h1>Chord staff — real playing, as the Studio pane draws it</h1>
<p>Each column: gap from the previous column's first onset, drawn duration (+ roll), the raw onsets
(note + ms after the column's first onset), and the hand split. Only the ${r.slots} columns the pane shows are listed.</p>
${cards.join('\n')}</body></html>`);
    return picks.length;
  } finally {
    await r.close();
  }
}

// ─── sweep ───────────────────────────────────────────────────────────────────

const SWEEP_GAPS = [90, 110, 130, 150];
const SWEEP_LEGATO = [80, 120, 160];

/**
 * --sweep-gap: the whole corpus under each (GAP_MS, LEGATO_RELEASE_MS) pair, plus each
 * gap with the release split OFF (legato -1: no release is ever within -1ms of an
 * arrival) to show what the split buys. The pair to ship is the one with chord whole
 * >= 90% and the lowest legato merged %.
 */
function sweep(takes) {
  const rows = [];
  for (const gapMs of SWEEP_GAPS) {
    for (const legatoReleaseMs of [-1, ...SWEEP_LEGATO]) {
      const o = blank();
      for (const t of takes) add(o, measure(t.events, { gapMs, legatoReleaseMs }));
      rows.push({
        GAP_MS: gapMs, LEGATO_RELEASE_MS: legatoReleaseMs < 0 ? 'off' : legatoReleaseMs,
        'whole %': pct(o.whole, o.clusters), 'held-chord whole %': pct(o.heldWhole, o.heldChords),
        'chord whole %': pct(o.chordWhole, o.chords), 'legato merged %': pct(o.legatoMerged, o.legatoPairs),
        'eighth %': pct(o.eighths, o.cols), frags: o.frags, rolled: o.rolled, 'RH-on-bass': o.rhOnBass,
        gate: o.chords && (100 * o.chordWhole) / o.chords >= 90 && o.rhOnBass === 0 ? 'PASS' : '',
      });
    }
  }
  console.log(`chord-staff-replay --sweep-gap: ${takes.length} takes, LEGATO_MIN_STEP_MS ${LEGATO_MIN_STEP_MS}`);
  console.table(rows);
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
    return;
  }
  const dataDir = args.data || process.env.DAYLIGHT_DATA_PATH;
  if (!dataDir) throw new Error('DAYLIGHT_DATA_PATH (or --data) is required');
  const mediaDir = args.media || process.env.DAYLIGHT_MEDIA_PATH || path.join(path.dirname(dataDir), 'media');

  const sources = [
    ...listStudio(dataDir, args.users, args.since),
    ...listCaptures(mediaDir, args.users, args.limit, args.since),
  ];

  const overall = blank();
  const bySource = {}; const byUser = {};
  const takes = [];
  let skipped = 0; let failed = 0;
  for (const s of sources) {
    let take;
    try { take = s.source === 'studio' ? loadStudio(s.file) : loadMidi(s.file); }
    catch (err) { failed += 1; console.warn(`skip ${s.file}: ${err.message}`); continue; }
    if (s.source === 'studio' && args.since && take.created && take.created < args.since) { skipped += 1; continue; }
    if (take.events.filter((e) => e.type === 'on').length < MIN_ONSETS) { skipped += 1; continue; }
    const m = measure(take.events);
    add(overall, m);
    add(bySource[s.source] ||= blank(), m);
    add(byUser[s.user] ||= blank(), m);
    takes.push({ ...s, events: take.events });
  }

  if (args.sweepGap) {
    sweep(takes);
    return;
  }

  console.log(`chord-staff-replay: ${takes.length} takes (${skipped} under ${MIN_ONSETS} onsets / before --since, ${failed} unreadable)`);
  console.log(`rules: GAP_MS ${GAP_MS}, LEGATO_RELEASE_MS ${LEGATO_RELEASE_MS}, LEGATO_MIN_STEP_MS ${LEGATO_MIN_STEP_MS}, SPAN_MAX_MS ${SPAN_MAX_MS}, ROLL_MARK_MS ${ROLL_MARK_MS}, MAX_COLUMN_NOTES ${MAX_COLUMN_NOTES}\n`);
  console.table([
    row('overall', overall),
    ...Object.entries(bySource).map(([k, m]) => row(k, m)),
    ...Object.entries(byUser).sort().map(([k, m]) => row(`  ${k}`, m)),
  ]);
  console.log(`clusters split by the gap rule, by the splitting silence (ms): ${JSON.stringify(overall.gaps)}`);
  console.log(`held chords split, by cause: ${JSON.stringify(overall.heldCauses)}`);
  console.log(`legato splits, by the step between the halves (ms): ${JSON.stringify(overall.legatoSteps)}`);
  console.log('baseline before the gesture rule (spec, 17 studio takes): whole 68.3%, eighths 49.9%, RH-on-bass 234');

  // Gated on chord whole %: whole % also counts every overlapping legato step as a
  // "cluster", so it rewards drawing a legato line as a chord — the error the release
  // split exists to fix. Both are printed.
  const wholePct = overall.clusters ? (100 * overall.whole) / overall.clusters : 0;
  const chordPct = overall.chords ? (100 * overall.chordWhole) / overall.chords : 0;
  const pass = chordPct >= 90 && overall.rhOnBass === 0;
  console.log(`\nwhole % over all clusters (legato steps included): ${wholePct.toFixed(1)}; legato merged ${pct(overall.legatoMerged, overall.legatoPairs)}% of ${overall.legatoPairs} legato pairs`);
  console.log(`gate: chord whole ${chordPct.toFixed(1)}% (need >= 90), RH-on-bass ${overall.rhOnBass} (need 0) -> ${pass ? 'PASS' : 'FAIL'}`);

  if (args.render) {
    const n = await renderMoments(args.render, takes, args.moments);
    console.log(`\nrendered ${n} moments -> ${path.join(args.render, 'index.html')}`);
  }
  if (!pass) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
