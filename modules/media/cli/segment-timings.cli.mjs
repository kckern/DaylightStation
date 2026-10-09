#!/usr/bin/env node

/**
 * Segment timings CLI — derive a work's movement boundaries from its audio.
 *
 * Written for Handel's Messiah (`plex:6918`): one 134-minute file, no chapter
 * atoms, no subtitle track, and 53 numbered movements in a printed libretto.
 *
 * THE RECORDING IS NOT THE SCORE. The audible span is ~118 minutes against ~140
 * for a complete Messiah, so this performance is cut by roughly twenty minutes —
 * eight to twelve numbers. Reconciling the two is therefore an ALIGNMENT, not a
 * selection, with four relationships to resolve:
 *
 *   1:1  a number is one audible span            the common case
 *   n:1  numbers run attacca, with no gap        a span too long for its form
 *   1:0  the number was cut                      no span to assign
 *   1:n  a break inside a number                 a span too short for its form
 *
 * The stages fail in opposite directions on purpose. `candidateBoundaries` must
 * OVER-produce, because a boundary it never emits cannot be recovered later.
 * `validateSpans` must UNDER-accept, because a rail that lies about position is
 * worse than a coarse one — the principle the whole surround subsystem is built
 * on.
 *
 * Usage:
 *   node cli/segment-timings.cli.mjs <media.mp4> <libretto.json> [out.json]
 *
 * @module cli/segment-timings
 */

/* -------------------------------------------------------------------------- */
/* STAGE 1 — candidates from silence                                          */
/* -------------------------------------------------------------------------- */

const SIL = /silence_(start|end): (-?[\d.]+)(?: \| silence_duration: ([\d.]+))?/g;

/**
 * Read `silencedetect`'s log into paired silences.
 *
 * `silencedetect` logs at INFO, so a run with `-v error` produces nothing at all
 * and this returns an empty list — which looks exactly like a recording with no
 * gaps. Always invoke it with `-hide_banner -nostats … 2>&1 | grep silencedetect`.
 */
export function parseSilences(stderr) {
  const out = [];
  let open = null;
  for (const m of String(stderr).matchAll(SIL)) {
    if (m[1] === 'start') { open = Number(m[2]); continue; }
    if (open === null) continue;
    out.push({ start: open, end: Number(m[2]), duration: Number(m[3] ?? (Number(m[2]) - open)) });
    open = null;
  }
  return out;
}

/**
 * Where the music RESUMES, one candidate per cluster.
 *
 * Taking the START of a silence would put the mark before the applause and the
 * settling, so a candidate is a silence's END.
 *
 * CLUSTER AND KEEP THE LONGEST, never "keep the first and drop the rest". On
 * this recording 84 of 142 raw spans are under 30 s — rests, fermatas and
 * breaths inside recitative — and a fermata resuming 20 s before the real
 * boundary would otherwise survive while the boundary was culled. That would
 * break this stage's only contract: its output must CONTAIN the true
 * boundaries. A longer silence is the better bet within a cluster, and it fails
 * toward a boundary rather than away from one.
 */
export function candidateBoundaries(silences, { minGapS = 30 } = {}) {
  const sorted = silences.slice().sort((a, b) => a.start - b.start);
  const clusters = [];
  for (const s of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && s.end - last[last.length - 1].end < minGapS) last.push(s);
    else clusters.push([s]);
  }
  return clusters.map((c) => c.reduce((a, b) => (b.duration > a.duration ? b : a)).end);
}

/* -------------------------------------------------------------------------- */
/* STAGE 2 — applause, which anchors the Parts and poisons candidates          */
/* -------------------------------------------------------------------------- */

/** A level below this reads as digital silence; `-inf` is floored to it. */
const DB_FLOOR = -120;

/**
 * Read `ametadata=print:key=lavfi.astats.Overall.RMS_level` output.
 *
 * The filter emits a `frame:` line carrying `pts_time`, then the level on the
 * next line. `-inf` appears wherever the signal is digitally silent and must be
 * floored rather than carried forward: `Number('-inf')` is NaN, and one NaN in
 * the HF-to-full ratio silently disqualifies that second from applause
 * detection.
 */
export function parseAstats(text) {
  const out = [];
  let t = null;
  for (const line of String(text).split('\n')) {
    const f = /pts_time:([\d.]+)/.exec(line);
    if (f) { t = Number(f[1]); continue; }
    const v = /RMS_level=(-?[\d.]+|-inf|inf|nan)/.exec(line);
    if (v && t !== null) {
      const db = /inf|nan/.test(v[1]) ? DB_FLOOR : Number(v[1]);
      out.push({ t, db });
      t = null;
    }
  }
  return out;
}

/**
 * Pair the full-band and high-pass passes into one frame per second.
 *
 * Only seconds present in BOTH survive: the two ffmpeg passes resample
 * differently (8 kHz and 32 kHz) and can disagree by a frame at the tail, and a
 * ratio computed from one real level and one missing one is worse than no ratio.
 */
export function zipFrames(full, hf) {
  const byT = new Map(hf.map((f) => [f.t, f.db]));
  return full
    .filter((f) => byT.has(f.t))
    .map((f) => ({ t: f.t, full: f.db, hf: byT.get(f.t) }));
}

/**
 * APPLAUSE IS BROAD-BAND AND SUSTAINED, and that pair is what separates it from
 * a loud tutti: the ratio of >9 kHz energy to full-band energy rises sharply
 * (hands, not instruments) and holds for seconds rather than a bar.
 *
 * @param {Array<{t:number, full:number, hf:number}>} frames per-second dB levels.
 */
export function applauseRuns(frames, { hfFloorDb = -26, minRunS = 5 } = {}) {
  const runs = [];
  let open = null;
  /**
   * `endT` is the LAST bright frame, so the run lasts `endT - open + 1` frames.
   * Measuring it as `endT - open` made an interior run and a run reaching the
   * end of the recording disagree by one second — the closing applause was
   * dropped where an identical interior run was kept.
   */
  const close = (endT) => {
    if (open !== null && endT - open + 1 >= minRunS) runs.push({ start: open, end: endT });
    open = null;
  };
  for (const f of frames) {
    const bright = (f.hf - f.full) >= hfFloorDb;
    if (bright && open === null) open = f.t;
    if (!bright) close(f.t - 1);
  }
  if (frames.length) close(frames[frames.length - 1].t);
  return runs;
}

/**
 * Drop candidates that fall inside — or at the leading edge of — applause.
 *
 * MEASURED, AND NOT WHAT A FIRST READING PREDICTS. Applause is LOUD, so
 * `silencedetect` never sees it; it sees the two short gaps that BRACKET it. The
 * Part One break here is a 1.5 s silence. So applause does not inflate the
 * previous number's span — it produces its OWN candidate at the instant the
 * clapping starts, and an aligner would hand that span of pure applause to the
 * next number. The gap before applause is not a boundary; the gap after it is.
 */
export function rejectApplauseCandidates(candidates, runs, { padS = 2 } = {}) {
  return candidates.filter(
    (c) => !runs.some((r) => c >= r.start - padS && c <= r.end + padS),
  );
}

/* -------------------------------------------------------------------------- */
/* STAGE 3 — the alignment, and the gate                                      */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* PER-NUMBER PRIORS, FROM REFERENCE RECORDINGS                               */
/* -------------------------------------------------------------------------- */

/**
 * Words that appear in almost every title and so distinguish nothing: the forms,
 * the voices, and English's commonest particles. Scoring on them would match
 * "Air (Tenor)" to "Air (Alto)" as readily as to the right movement.
 */
const NOISE = new Set([
  'air', 'aria', 'chorus', 'recitative', 'accompagnato', 'accompanied', 'duet',
  'soli', 'sinfonia', 'sinfony', 'symphony', 'pifa', 'arioso',
  'soprano', 'alto', 'contralto', 'countertenor', 'tenor', 'bass', 'baritone',
  'the', 'a', 'of', 'and', 'to', 'in', 'is', 'that', 'for', 'his', 'he', 'they',
  'shall', 'be', 'with', 'it', 'was', 'my', 'we', 'us', 'our', 'thou', 'ye',
]);

/** Lowercase, fold curly punctuation, split into words. */
function words(s) {
  return String(s)
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^a-z' ]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length > 1);
}

/**
 * The distinctive words of a title — noise dropped.
 *
 * WITH ONE FALLBACK, and it is not a nicety: an INSTRUMENTAL number's whole
 * title IS its form (`Sinfonia`, `Pifa`), so stripping form words leaves nothing
 * at all and the number can never match. Where that happens the form words are
 * exactly the distinguishing ones, so they are kept.
 */
function keyWords(s) {
  const all = words(s);
  const distinctive = all.filter((w) => !NOISE.has(w));
  return (distinctive.length ? distinctive : all).map(stem);
}

/**
 * The first five letters.
 *
 * Crude, and enough: the sources spell the same movement `Sinfonia` and
 * `Sinfony`, and inflect verbs differently. Five letters folds those together
 * without folding distinct movements together, because a match still needs half
 * a title's words to agree.
 */
const stem = (w) => w.slice(0, 5);

/** The searchable side keeps EVERY word, form included — see `keyWords`. */
const trackWords = (s) => new Set(words(s).map(stem));

/**
 * Give each libretto number the duration of its track in a reference recording.
 *
 * TITLES ARE MATCHED, NEVER INVENTED. The three sources wear different form
 * prefixes, different spellings (`Sinfonia`/`Sinfony`) and different punctuation,
 * but they share the incipit's distinctive words. Anything scoring below the
 * threshold stays `null` and is reported — the reference recordings have 51 and
 * 57 entries against the libretto's 53, so some numbers genuinely have no track.
 *
 * Each track is spent once: two numbers claiming one recording would give both a
 * duration that only one of them can own.
 */
export function matchReference({ items, tracks, threshold = 0.5 }) {
  const trackKeys = tracks.map((t) => trackWords(t.title));
  const taken = new Set();
  const expected = [];
  const unmatched = [];
  items.forEach((it) => {
    const want = keyWords(it.incipit);
    let best = -1;
    let bestScore = 0;
    trackKeys.forEach((keys, j) => {
      if (taken.has(j) || !want.length) return;
      const hits = want.filter((w) => keys.has(w)).length;
      const score = hits / want.length;
      if (score > bestScore) { bestScore = score; best = j; }
    });
    if (best >= 0 && bestScore >= threshold) {
      taken.add(best);
      expected.push(tracks[best].seconds);
    } else {
      expected.push(null);
      unmatched.push(`No. ${it.n} ${it.incipit}`);
    }
  });
  return { expected, report: { matched: expected.filter((e) => e !== null).length, unmatched } };
}

/**
 * Combine two references into one expectation per number.
 *
 * WHERE THEY AGREE, TRUST THEM; WHERE THEY DO NOT, SAY SO. The studio album has
 * one 450 s track for the closing chorus where the live performance splits it in
 * two (198 + 263 = 461) — those reconcile, but averaging 450 and 198 would
 * invent a number neither recording supports. A disagreement is a granularity
 * mismatch to resolve, not noise to smooth, so it returns `null` and is listed.
 */
export function reconcileReferences(a, b, { tolerance = 0.15 } = {}) {
  const expected = [];
  const disputed = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? null;
    const y = b[i] ?? null;
    if (x === null && y === null) { expected.push(null); continue; }
    if (x === null || y === null) { expected.push(x ?? y); continue; }
    const off = Math.abs(x - y) / ((x + y) / 2);
    if (off <= tolerance) expected.push(Math.round((x + y) / 2));
    else { expected.push(null); disputed.push(i); }
  }
  return { expected, disputed };
}

/**
 * How long a number of each form runs, in seconds.
 *
 * Deliberately WIDE. These are not a model of Messiah, they are a sieve: their
 * job is to reject a span that could not possibly be its own form — a
 * "recitative" of six minutes is a missed boundary, not a slow reading — while
 * never rejecting a real one. A tight prior would silently discard correct
 * boundaries, which is the failure this gate exists to avoid.
 *
 * The Air ceiling is 660 s because a da capo air runs past ten minutes.
 */
export const FORM_DURATIONS = Object.freeze({
  Recitative: [15, 180],
  Air: [90, 660],
  Duet: [90, 420],
  Chorus: [60, 420],
  Soli: [60, 420],
  Sinfonia: [120, 300],
  Pifa: [60, 240],
  Symphony: [60, 300],
});

/** A skipped number is normal here — this performance omits 8-12 of 53 — but not free. */
export const SKIP_PENALTY = 40;

/**
 * What ANY implausible span costs.
 *
 * THE SEARCH MUST OPTIMISE WHAT THE GATE MEASURES, and for one run of this
 * pipeline it did not. `spanCost` grew linearly with the violation, so a span
 * four seconds under its floor cost 4 while a skip cost 40 — and the search
 * bought the bad candidate every time. But `validateSpans` is BINARY: any span
 * outside its prior fails, so an alignment containing one is worthless however
 * cheap the search thought it was. On the real recording that mismatch produced
 * ONE omission where the duration arithmetic requires eight to twelve, and ten
 * failures of which nine were within fifteen seconds of their floor.
 *
 * So the objective is lexicographic, expressed as a number: first minimise
 * implausible spans, then minimise skips. This constant is what makes that true
 * — it exceeds every skip the work could ever need (53 x SKIP_PENALTY = 2120),
 * so no quantity of omissions is ever traded for a single bad span.
 */
export const IMPLAUSIBLE_COST = 100_000;

/**
 * What an assignment costs.
 *
 * Zero inside the form's prior. Outside it, `IMPLAUSIBLE_COST` plus the
 * magnitude — the magnitude surviving only as a tie-break, so that when every
 * candidate alignment has violations the least-wrong one still wins.
 */
export function spanCost(item, seconds, expectedS = null, rho = 1) {
  // A PER-NUMBER EXPECTATION BEATS A PER-FORM RANGE, and that is the whole point
  // of the reference recordings: "this chorus runs 450s" is a target where "a
  // chorus runs 60-420s" is a range that admits almost anything. Measured, the
  // range-only gate held for four end times twelve minutes apart.
  //
  // `rho` is the performance's tempo ratio against the reference. The tolerance
  // is PROPORTIONAL because a live reading differs from a reference by a
  // percentage, not by a fixed number of seconds — the two references disagree
  // with each other by a median 8%.
  if (Number.isFinite(expectedS) && expectedS > 0) {
    const want = expectedS * rho;
    const off = Math.abs(seconds - want) / want;
    return off <= TEMPO_TOLERANCE ? off : IMPLAUSIBLE_COST + off;
  }
  const prior = FORM_DURATIONS[item.form];
  if (!prior) return IMPLAUSIBLE_COST * 2;    // unknown form: never free
  if (seconds < prior[0]) return IMPLAUSIBLE_COST + (prior[0] - seconds);
  if (seconds > prior[1]) return IMPLAUSIBLE_COST + (seconds - prior[1]);
  return 0;
}

/**
 * How far a span may sit from its reference duration and still be the same
 * movement. The two reference recordings disagree with each other by a median
 * 8%; this allows a good deal more than that before calling a span wrong.
 */
export const TEMPO_TOLERANCE = 0.30;

/**
 * THE GATE. An assignment is accepted only if every sounding number's span is
 * plausible for its own form.
 *
 * `starts` is always the libretto's length, positional, and an entry may be
 * `null` — this performance omits that number. A number's span runs to the next
 * NON-NULL start, so an omission never shifts a neighbour's timing. That is the
 * store's own semantics: an invalid `starts` entry drops to `undefined` and
 * positions are preserved rather than compacted.
 *
 * Returning the failures rather than a bare false is the point: a rejected set
 * names which numbers were implausible and in which direction, which makes the
 * next iteration a correction instead of a guess.
 */
export function validateSpans({ items, starts, endS }) {
  const failures = [];
  if (items.length !== starts.length) {
    failures.push(`${items.length} numbers but ${starts.length} starts`);
    return { ok: false, spans: [], failures };
  }
  /** The next start that actually sounds — an omitted number owns no time. */
  const nextSounding = (from) => {
    for (let j = from; j < starts.length; j += 1) {
      if (Number.isFinite(starts[j])) return starts[j];
    }
    return endS;
  };
  const spans = items.map((it, i) => {
    if (!Number.isFinite(starts[i])) {
      return { n: it.n, form: it.form, seconds: null, plausible: true, omitted: true };
    }
    const seconds = Math.round(nextSounding(i + 1) - starts[i]);
    const prior = FORM_DURATIONS[it.form];
    // FAIL CLOSED. An unknown form means the parse was shaky for exactly this
    // number, which is the last place to hand out a free pass.
    if (!prior) {
      failures.push(`No. ${it.n} "${it.incipit}" has form ${JSON.stringify(it.form)} with no duration prior`);
      return { n: it.n, form: it.form, seconds, plausible: false, omitted: false };
    }
    const plausible = seconds >= prior[0] && seconds <= prior[1];
    if (!plausible) {
      // TOO LONG means a hidden attacca join — two numbers sharing one span, and
      // the place to aim the texture detector. TOO SHORT means a break inside a
      // number. The two need opposite fixes, so the message says which.
      const how = seconds > prior[1] ? 'too long — a hidden join?' : 'too short — a break inside it?';
      failures.push(`No. ${it.n} "${it.incipit}" (${it.form}) ran ${seconds}s, expected ${prior[0]}-${prior[1]}s — ${how}`);
    }
    return { n: it.n, form: it.form, seconds, plausible, omitted: false };
  });
  return { ok: failures.length === 0, spans, failures };
}

/**
 * Map the libretto's numbers onto the audible candidates.
 *
 * A SHORTEST-PATH PROBLEM. A state is "number i begins at candidate j". Moving
 * to the next state consumes candidates and may skip numbers; a move costs how
 * implausible the resulting span is for that number's form, plus a penalty per
 * skipped number. The cheapest path is the alignment.
 *
 * ONE MODELLING CONSEQUENCE, stated plainly: a number that was CUT and a number
 * that runs attacca and could not be split are both `null` here, because
 * positional starts cannot express "shares a span with its neighbour". The two
 * are distinguished in the report, never in the data — a span flagged too-long
 * is a suspected join; an unassigned number with no over-long neighbour is a
 * suspected cut.
 *
 * @returns {{starts:Array<number|null>, report:{cost:number, skipped:string[]}}}
 */
export function alignLibretto({ items, candidates, endS, expected = null, rho = 1 }) {
  const exp = (i) => (expected ? expected[i] : null);
  const N = items.length;
  const M = candidates.length;
  if (!N || !M) return { starts: new Array(N).fill(null), report: { cost: Infinity, skipped: [] } };

  const best = Array.from({ length: N }, () => new Array(M).fill(Infinity));
  const from = Array.from({ length: N }, () => new Array(M).fill(null));
  // Number 0 may begin at any candidate, but starting later means discarding
  // audible time, so later starts cost a little more.
  for (let j = 0; j < M; j += 1) best[0][j] = j * 5;

  for (let i = 0; i < N; i += 1) {
    for (let j = 0; j < M; j += 1) {
      if (best[i][j] === Infinity) continue;
      for (let j2 = j + 1; j2 < M; j2 += 1) {
        const base = best[i][j] + spanCost(items[i], candidates[j2] - candidates[j], exp(i), rho);
        // i2 is the next number that SOUNDS; everything between i and i2 is skipped.
        for (let i2 = i + 1; i2 < N; i2 += 1) {
          const cost = base + (i2 - i - 1) * SKIP_PENALTY;
          if (cost < best[i2][j2]) { best[i2][j2] = cost; from[i2][j2] = [i, j]; }
        }
      }
    }
  }

  // Close the path: the last sounding number runs to endS, and every number
  // after it is skipped.
  let endBest = Infinity;
  let endAt = null;
  for (let i = 0; i < N; i += 1) {
    for (let j = 0; j < M; j += 1) {
      if (best[i][j] === Infinity) continue;
      const cost = best[i][j] + spanCost(items[i], endS - candidates[j], exp(i), rho) + (N - 1 - i) * SKIP_PENALTY;
      if (cost < endBest) { endBest = cost; endAt = [i, j]; }
    }
  }

  const starts = new Array(N).fill(null);
  for (let at = endAt; at; at = from[at[0]][at[1]]) starts[at[0]] = candidates[at[1]];
  return {
    starts,
    report: {
      cost: endBest,
      skipped: items.filter((_, i) => starts[i] === null).map((it) => `No. ${it.n} ${it.incipit}`),
    },
  };
}
