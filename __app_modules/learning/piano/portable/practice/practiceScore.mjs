/**
 * practiceScore — weighs a stream of human-played notes for how practice-like
 * they are. Pure, no Node or DOM APIs (the kiosk and the server both import it).
 *
 * Input notes are already human-only (humanNoteClassifier strips the piano's
 * own rhythm loop and clockwork). This module discounts what a hand does when
 * it is NOT practising: fists and palms, one key hammered, keys scattered
 * across the keyboard, glissando bursts, minutes-long non-stop streams, and
 * flat-velocity bangs. Clumsy beginner playing — wrong notes, uneven timing,
 * small chords — keeps full weight.
 *
 * Every rule works inside one "stretch" (a run of notes with no gap over
 * `stretchGapMs`), so a live meter can weigh each closed stretch once and only
 * re-weigh the open one.
 *
 * Calibration: see practiceScore.calibration.test.mjs (audit sittings + mash).
 */

export const PRACTICE_DEFAULTS = Object.freeze({
  chordMs: 50,             // onsets this close are one chord
  stretchGapMs: 2000,      // a longer gap ends a stretch
  clusterGap: 7,           // semitone gap that splits a chord into hands
  handSpan: 12,            // widest cluster a hand covers
  fistNotes: 6,            // chord this big weighs 0
  fiveNoteFactor: 0.5,
  spreadChordFactor: 0.5,  // ≤4 notes but in 3+ clusters
  hammerRun: 10,           // consecutive single-pitch onsets
  hammerFactor: 0,
  scatterWindow: 10,
  scatterSpan: 40,         // wider than two hands in their positions
  scatterMeanJump: 15,
  scatterMinWindow: 6,     // a shorter stretch uses its whole length as the window
  scatterDistinctShare: 0.8, // share of distinct pitches in the window (two fixed hands far apart are not scatter)
  scatterFactor: 0,
  burstWindow: 12,
  burstMedianIoiMs: 70,
  burstMinWindow: 5,
  sweepChords: 4,
  sweepMaxStep: 3,
  sweepMedianIoiMs: 75,
  burstFactor: 0,
  streamMinMs: 60000,
  streamRate: 6,           // onsets per second
  streamRestMs: 1000,
  streamFactor: 0.5,
  flatWindow: 16,
  flatSpread: 2,
  flatFactor: 0.5,         // mild: a piano set to fixed touch is still a child playing
  bangVelocity: 120,
  bangMinNotes: 8,
  bangFactor: 0,
  legitWeight: 0.5,        // a note at least this weight is "legit"
});

/**
 * Preschool mode (courses listed in `videos.practice.preschool_courses`): every
 * human key press is practice; only machine streams and silence are not.
 */
export const PRESCHOOL_PRACTICE = Object.freeze({ lenient: true });

const PENALTY_KEYS = ['fist', 'span', 'hammer', 'scatter', 'burst', 'stream', 'flatVelocity', 'bang'];

function emptyPenalties() {
  const p = {};
  for (const k of PENALTY_KEYS) p[k] = 0;
  return p;
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Split sorted events into stretches (arrays of events). */
function splitStretches(events, o) {
  const out = [];
  let cur = [];
  let last = -Infinity;
  for (const e of events) {
    if (cur.length && e.t - last > o.stretchGapMs) { out.push(cur); cur = []; }
    cur.push(e);
    last = e.t;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Weigh one stretch. Returns per-note weights (same order as `stretch`) and
 * penalty counts (notes affected per rule).
 */
function weighStretch(stretch, o) {
  const n = stretch.length;
  const w = new Array(n).fill(1);
  const penalties = emptyPenalties();
  // Preschool: any deliberate key press counts — fists, palms, one key over
  // and over. Machine traffic is already gone (humanNoteClassifier).
  if (o.lenient) return { weights: w, penalties };
  const hit = (key, idxs, factor) => {
    for (const i of idxs) w[i] *= factor;
    penalties[key] += idxs.length;
  };

  // Chords: indices grouped by onset proximity to the chord's first note.
  const chords = [];
  for (let i = 0; i < n; i++) {
    const c = chords[chords.length - 1];
    if (c && stretch[i].t - c.t <= o.chordMs) c.idx.push(i);
    else chords.push({ t: stretch[i].t, idx: [i] });
  }

  // Chord shape.
  for (const c of chords) {
    const pitches = c.idx.map((i) => stretch[i].note).sort((a, b) => a - b);
    const clusters = [];
    for (const p of pitches) {
      const cl = clusters[clusters.length - 1];
      if (cl && p - cl[cl.length - 1] <= o.clusterGap) cl.push(p);
      else clusters.push([p]);
    }
    const wide = clusters.some((cl) => cl[cl.length - 1] - cl[0] > o.handSpan);
    if (pitches.length >= o.fistNotes) hit('fist', c.idx, 0);
    else if (wide) hit('span', c.idx, 0);
    else if (pitches.length === 5) hit('fist', c.idx, o.fiveNoteFactor);
    else if (clusters.length > 2) hit('span', c.idx, o.spreadChordFactor);
    c.pitch = pitches.reduce((a, b) => a + b, 0) / pitches.length;
    c.single = pitches.length === 1 ? pitches[0] : null;
  }

  // Hammering: runs of single-note chords on one pitch.
  let runStart = 0;
  for (let k = 1; k <= chords.length; k++) {
    const same = k < chords.length && chords[k].single != null && chords[k].single === chords[k - 1].single;
    if (!same) {
      if (k - runStart >= o.hammerRun && chords[runStart].single != null) {
        hit('hammer', chords.slice(runStart, k).flatMap((c) => c.idx), o.hammerFactor);
      }
      runStart = k;
    }
  }

  // Rolling chord windows: scatter and bursts. Each note is hit at most once per rule.
  const scatterSet = new Set();
  const burstSet = new Set();
  const sw = Math.min(o.scatterWindow, chords.length);
  for (let k = 0; sw >= o.scatterMinWindow && k + sw <= chords.length; k++) {
    const win = chords.slice(k, k + sw);
    const ps = win.map((c) => c.pitch);
    const span = Math.max(...ps) - Math.min(...ps);
    let jump = 0;
    for (let j = 1; j < ps.length; j++) jump += Math.abs(ps[j] - ps[j - 1]);
    const distinct = new Set(win.flatMap((c) => c.idx.map((i) => stretch[i].note))).size;
    if (span > o.scatterSpan && jump / (ps.length - 1) > o.scatterMeanJump && distinct >= o.scatterDistinctShare * sw) {
      for (const c of win) for (const i of c.idx) scatterSet.add(i);
    }
  }
  const bw = Math.min(o.burstWindow, chords.length);
  for (let k = 0; bw >= o.burstMinWindow && k + bw <= chords.length; k++) {
    const win = chords.slice(k, k + bw);
    const iois = [];
    for (let j = 1; j < win.length; j++) iois.push(win[j].t - win[j - 1].t);
    if (median(iois) < o.burstMedianIoiMs) for (const c of win) for (const i of c.idx) burstSet.add(i);
  }
  // A short sweep (a glissando too short for the window above): 4 chords in a
  // row, all one direction in small steps, faster than a hand plays notes on purpose.
  for (let k = 0; k + o.sweepChords <= chords.length; k++) {
    const win = chords.slice(k, k + o.sweepChords);
    const iois = [];
    let up = 0; let down = 0;
    for (let j = 1; j < win.length; j++) {
      iois.push(win[j].t - win[j - 1].t);
      const step = win[j].pitch - win[j - 1].pitch;
      if (step > 0 && step <= o.sweepMaxStep) up++; else if (step < 0 && -step <= o.sweepMaxStep) down++;
    }
    const monotone = up === win.length - 1 || down === win.length - 1;
    if (monotone && median(iois) < o.sweepMedianIoiMs) for (const c of win) for (const i of c.idx) burstSet.add(i);
  }
  if (scatterSet.size) hit('scatter', [...scatterSet], o.scatterFactor);
  if (burstSet.size) hit('burst', [...burstSet], o.burstFactor);

  // Streams: rest-free runs (chord IOI < streamRestMs) that last long and fast.
  let segStart = 0;
  for (let k = 1; k <= chords.length; k++) {
    const rest = k === chords.length || chords[k].t - chords[k - 1].t >= o.streamRestMs;
    if (rest) {
      const ms = chords[k - 1].t - chords[segStart].t;
      const rate = (k - segStart) / Math.max(ms / 1000, 1e-9);
      if (ms > o.streamMinMs && rate > o.streamRate) {
        hit('stream', chords.slice(segStart, k).flatMap((c) => c.idx), o.streamFactor);
      }
      segStart = k;
    }
  }

  // Velocity: flat rolling windows of notes, and all-bang stretches.
  const flatSet = new Set();
  for (let i = 0; i + o.flatWindow <= n; i++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = i; j < i + o.flatWindow; j++) { lo = Math.min(lo, stretch[j].velocity); hi = Math.max(hi, stretch[j].velocity); }
    if (hi - lo <= o.flatSpread) for (let j = i; j < i + o.flatWindow; j++) flatSet.add(j);
  }
  if (flatSet.size) hit('flatVelocity', [...flatSet], o.flatFactor);
  if (n >= o.bangMinNotes && stretch.every((e) => e.velocity >= o.bangVelocity)) {
    hit('bang', stretch.map((_, i) => i), o.bangFactor);
  }

  return { weights: w, penalties };
}

function normalise(events) {
  return events
    .filter((e) => e && Number.isFinite(e.t) && Number.isFinite(e.note))
    .map((e) => ({ t: e.t, note: e.note, velocity: Number.isFinite(e.velocity) ? e.velocity : 64, durMs: e.durMs ?? null }))
    .sort((a, b) => a.t - b.t);
}

function addPenalties(into, from) {
  for (const k of PENALTY_KEYS) into[k] += from[k];
}

function finishTally(humanNotes, practiceNotes, penalties) {
  return {
    humanNotes,
    practiceNotes,
    retention: humanNotes ? practiceNotes / humanNotes : 0,
    penalties,
  };
}

/** Per-note weights over a whole event list (sorted by time). */
export function weighEvents(events, options = {}) {
  const o = { ...PRACTICE_DEFAULTS, ...options };
  const evs = normalise(events);
  const out = [];
  for (const s of splitStretches(evs, o)) {
    const { weights } = weighStretch(s, o);
    s.forEach((e, i) => out.push({ ...e, weight: weights[i] }));
  }
  return out;
}

/** @returns {{ humanNotes, practiceNotes, retention, penalties }} */
export function tallyPractice(events, options = {}) {
  const o = { ...PRACTICE_DEFAULTS, ...options };
  const evs = normalise(events || []);
  const penalties = emptyPenalties();
  let practice = 0;
  for (const s of splitStretches(evs, o)) {
    const r = weighStretch(s, o);
    practice += r.weights.reduce((a, b) => a + b, 0);
    addPenalties(penalties, r.penalties);
  }
  return finishTally(evs.length, practice, penalties);
}

/**
 * A live meter: add events in time order; closed stretches are weighed once.
 * snapshot() equals tallyPractice(all added events).
 */
export function createPracticeMeter(options = {}) {
  const o = { ...PRACTICE_DEFAULTS, ...options };
  let closed = { humanNotes: 0, practiceNotes: 0, penalties: emptyPenalties() };
  let open = [];
  let all = [];
  const KEEP = 400; // events kept for since()

  function closeOpen() {
    if (!open.length) return;
    const r = weighStretch(open, o);
    closed.humanNotes += open.length;
    closed.practiceNotes += r.weights.reduce((a, b) => a + b, 0);
    addPenalties(closed.penalties, r.penalties);
    open = [];
  }

  return {
    add(e) {
      if (!e || !Number.isFinite(e.t) || !Number.isFinite(e.note)) return;
      const ev = { t: e.t, note: e.note, velocity: Number.isFinite(e.velocity) ? e.velocity : 64, durMs: e.durMs ?? null };
      const last = open[open.length - 1];
      if (last && ev.t - last.t > o.stretchGapMs) closeOpen();
      open.push(ev);
      all.push(ev);
      if (all.length > KEEP * 2) all = all.slice(-KEEP);
      return ev;
    },
    snapshot() {
      const penalties = { ...closed.penalties };
      let practice = closed.practiceNotes;
      if (open.length) {
        const r = weighStretch(open, o);
        practice += r.weights.reduce((a, b) => a + b, 0);
        addPenalties(penalties, r.penalties);
      }
      return finishTally(closed.humanNotes + open.length, practice, penalties);
    },
    /**
     * Take back events of the OPEN stretch (and the since() window) that turn
     * out to be machine — the rhythm loop is only recognised ~20 s after it
     * starts, and it streams without a 2 s gap, so its notes are all still
     * in the open stretch. Returns how many were removed.
     */
    retract(predicate) {
      const before = open.length;
      open = open.filter((e) => !predicate(e));
      all = all.filter((e) => !predicate(e));
      return before - open.length;
    },
    /** Events added at or after tMs (most recent ~400 kept). */
    since(tMs) {
      return all.filter((e) => e.t >= tMs);
    },
    reset() {
      closed = { humanNotes: 0, practiceNotes: 0, penalties: emptyPenalties() };
      open = [];
      all = [];
    },
  };
}

// ── Bursts: what happens between two presence check-ins ────────────────────

export const BURST_DEFAULTS = Object.freeze({
  legitNotes: 8,
  minDistinct: 2,          // 8 presses of ONE key is spam however it is weighed (two keys can be a rhythm exercise)
  legitRetention: 0.8,
  spamRetention: 0.4,
  maxStateNotes: 200,
});

function burstStats(evs) {
  const pitches = evs.map((e) => e.note);
  const vels = evs.map((e) => e.velocity);
  const iois = [];
  for (let i = 1; i < evs.length; i++) iois.push(evs[i].t - evs[i - 1].t);
  return {
    notes: evs.length,
    distinctPitches: new Set(pitches).size,
    pitchSpan: pitches.length ? Math.max(...pitches) - Math.min(...pitches) : 0,
    medianIoiMs: Math.round(median(iois)),
    velocitySpread: vels.length ? Math.max(...vels) - Math.min(...vels) : 0,
  };
}

/**
 * Label a burst of human notes: 'legit' | 'spam' | 'ambiguous'.
 * @returns {{ verdict, legitNotes, retention, stats }}
 */
export function classifyBurst(events, options = {}) {
  const o = { ...BURST_DEFAULTS, ...options };
  const weighed = weighEvents(events || [], options);
  const legitNotes = weighed.filter((e) => e.weight >= (options.legitWeight ?? PRACTICE_DEFAULTS.legitWeight)).length;
  const total = weighed.reduce((a, e) => a + e.weight, 0);
  const retention = weighed.length ? total / weighed.length : 0;
  const stats = burstStats(weighed);
  if (options.lenient) {
    return { verdict: legitNotes >= o.legitNotes ? 'legit' : 'spam', legitNotes, retention, stats };
  }
  let verdict;
  if (legitNotes < o.legitNotes || retention <= o.spamRetention || stats.distinctPitches < o.minDistinct) verdict = 'spam';
  else if (retention >= o.legitRetention) verdict = 'legit';
  else verdict = 'ambiguous';
  return { verdict, legitNotes, retention, stats };
}

/**
 * The minimal MIDI log sent to the legitimacy judge: notes (pitch, onset ms
 * relative to the first, duration ms, velocity) and five derived numbers.
 * Nothing else — no image, no audio, no identifiers.
 */
export function burstState(events, stats, options = {}) {
  const max = options.maxStateNotes ?? BURST_DEFAULTS.maxStateNotes;
  const evs = normalise(events || []).slice(-max);
  const t0 = evs.length ? evs[0].t : 0;
  const s = stats || burstStats(evs);
  return {
    notes: evs.map((e) => ({
      pitch: e.note,
      onsetMs: Math.round(e.t - t0),
      durMs: Number.isFinite(e.durMs) ? Math.round(e.durMs) : null,
      velocity: e.velocity,
    })),
    stats: {
      notes: s.notes,
      distinctPitches: s.distinctPitches,
      pitchSpan: s.pitchSpan,
      medianIoiMs: s.medianIoiMs,
      velocitySpread: s.velocitySpread,
    },
  };
}
