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

/** How badly a span misses its form's prior, in seconds outside the range. */
export function spanCost(item, seconds) {
  const prior = FORM_DURATIONS[item.form];
  if (!prior) return SKIP_PENALTY * 2;        // unknown form: never free
  if (seconds < prior[0]) return prior[0] - seconds;
  if (seconds > prior[1]) return seconds - prior[1];
  return 0;
}

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
export function alignLibretto({ items, candidates, endS }) {
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
        const base = best[i][j] + spanCost(items[i], candidates[j2] - candidates[j]);
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
      const cost = best[i][j] + spanCost(items[i], endS - candidates[j]) + (N - 1 - i) * SKIP_PENALTY;
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
