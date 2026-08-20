// cli/segment-timings.cli.test.mjs
//
// Deriving movement boundaries from audio. Every stage here is pure: the file
// I/O lives in the CLI shell, so none of this needs a 3 GB video to test.
//
// The stages fail in opposite directions and that shapes the tests. The
// candidate finder must OVER-produce — a boundary it never emits cannot be
// recovered downstream — while the gate must UNDER-accept, because a rail that
// lies about position is worse than a coarse one.

import { describe, it, expect } from 'vitest';
import {
  parseSilences, candidateBoundaries, applauseRuns, rejectApplauseCandidates, parseAstats, zipFrames,
  FORM_DURATIONS, spanCost, alignLibretto, validateSpans, SKIP_PENALTY, IMPLAUSIBLE_COST,
  matchReference, reconcileReferences,
} from './segment-timings.cli.mjs';
import { RECOGNISED_FORMS } from './libretto.cli.mjs';

const STDERR = [
  '[silencedetect @ 0x1] silence_start: 83.4',
  '[silencedetect @ 0x1] silence_end: 85.1 | silence_duration: 1.7',
  '[silencedetect @ 0x1] silence_start: 90.0',
  '[silencedetect @ 0x1] silence_end: 90.8 | silence_duration: 0.8',
].join('\n');

describe('parseSilences', () => {
  it('pairs each start with its end and duration', () => {
    expect(parseSilences(STDERR)).toEqual([
      { start: 83.4, end: 85.1, duration: 1.7 },
      { start: 90.0, end: 90.8, duration: 0.8 },
    ]);
  });

  it('ignores a trailing unpaired start', () => {
    expect(parseSilences(`${STDERR}\n[silencedetect @ 0x1] silence_start: 99.0`)).toHaveLength(2);
  });

  /** `silencedetect` logs at INFO; a run with `-v error` yields nothing at all. */
  it('finds nothing in empty output rather than throwing', () => {
    expect(parseSilences('')).toEqual([]);
  });
});

describe('candidateBoundaries', () => {
  it('takes the point music RESUMES, not where it stopped', () => {
    expect(candidateBoundaries(parseSilences(STDERR), { minGapS: 0 })).toEqual([85.1, 90.8]);
  });

  /**
   * CLUSTER AND KEEP THE LONGEST — never "keep the first and drop the rest".
   * A fermata resuming 20 s before the real boundary would otherwise survive and
   * the boundary be culled, breaking this stage's only contract: its output must
   * CONTAIN the true boundaries.
   */
  it('collapses a cluster to its longest silence, not its first', () => {
    expect(candidateBoundaries(parseSilences(STDERR), { minGapS: 30 })).toEqual([85.1]);
  });

  it('keeps the later candidate when IT is the longer silence', () => {
    const s = parseSilences([
      '[silencedetect] silence_start: 83.4',
      '[silencedetect] silence_end: 84.0 | silence_duration: 0.6',
      '[silencedetect] silence_start: 90.0',
      '[silencedetect] silence_end: 93.0 | silence_duration: 3.0',
    ].join('\n'));
    expect(candidateBoundaries(s, { minGapS: 30 })).toEqual([93.0]);
  });
});

describe('applauseRuns', () => {
  /** Applause is broad-band: its >9kHz energy sits close to its full-band energy. */
  const frame = (t, full, hf) => ({ t, full, hf });

  it('finds a sustained broad-band run and reports its span', () => {
    const frames = [
      ...Array.from({ length: 5 }, (_, i) => frame(i, -20, -60)),
      ...Array.from({ length: 8 }, (_, i) => frame(5 + i, -25, -45)),
      ...Array.from({ length: 5 }, (_, i) => frame(13 + i, -20, -60)),
    ];
    expect(applauseRuns(frames, { hfFloorDb: -26, minRunS: 5 }))
      .toEqual([{ start: 5, end: 12 }]);
  });

  it('ignores a bright passage that is not sustained', () => {
    const frames = [
      ...Array.from({ length: 5 }, (_, i) => frame(i, -20, -60)),
      frame(5, -25, -45), frame(6, -25, -45),
      ...Array.from({ length: 5 }, (_, i) => frame(7 + i, -20, -60)),
    ];
    expect(applauseRuns(frames, { hfFloorDb: -26, minRunS: 5 })).toEqual([]);
  });

  /** A run reaching the end of the frames is measured the same way as an interior one. */
  it('measures a run that reaches the end of the recording consistently', () => {
    const frames = Array.from({ length: 10 }, (_, i) => frame(i, -20, i >= 5 ? -45 : -60));
    expect(applauseRuns(frames, { hfFloorDb: -26, minRunS: 5 }))
      .toEqual([{ start: 5, end: 9 }]);
  });
});

describe('parseAstats', () => {
  const OUT = [
    'frame:0    pts:0       pts_time:0',
    'lavfi.astats.Overall.RMS_level=-23.383756',
    'frame:1    pts:8000    pts_time:1',
    'lavfi.astats.Overall.RMS_level=-23.555613',
  ].join('\n');

  it('reads one level per second, keyed by pts_time', () => {
    expect(parseAstats(OUT)).toEqual([
      { t: 0, db: -23.383756 },
      { t: 1, db: -23.555613 },
    ]);
  });

  /** Digital silence reports `-inf`, which must not become NaN and poison a ratio. */
  it('floors an -inf level rather than carrying it into the arithmetic', () => {
    const inf = 'frame:0 pts:0 pts_time:0\nlavfi.astats.Overall.RMS_level=-inf';
    expect(parseAstats(inf)).toEqual([{ t: 0, db: -120 }]);
  });
});

describe('zipFrames', () => {
  it('pairs the full-band and high-pass passes by second', () => {
    const full = [{ t: 0, db: -20 }, { t: 1, db: -21 }];
    const hf = [{ t: 0, db: -60 }, { t: 1, db: -45 }];
    expect(zipFrames(full, hf)).toEqual([
      { t: 0, full: -20, hf: -60 },
      { t: 1, full: -21, hf: -45 },
    ]);
  });

  it('keeps only seconds present in BOTH passes, so a ratio is never half-real', () => {
    const full = [{ t: 0, db: -20 }, { t: 1, db: -21 }, { t: 2, db: -22 }];
    const hf = [{ t: 0, db: -60 }, { t: 2, db: -50 }];
    expect(zipFrames(full, hf).map((f) => f.t)).toEqual([0, 2]);
  });
});

describe('rejectApplauseCandidates', () => {
  /**
   * MEASURED, AND NOT WHAT A FIRST READING PREDICTS. Applause is LOUD, so
   * `silencedetect` never sees it — it sees the two short gaps that bracket it.
   * So applause does not inflate the previous number's span; it produces its own
   * candidate at the instant the clapping starts, and an aligner would hand that
   * span of pure applause to the next number.
   */
  it('drops the candidate marking the START of applause, keeping the one after', () => {
    const runs = [{ start: 100, end: 160 }];
    expect(rejectApplauseCandidates([50, 99, 130, 165], runs)).toEqual([50, 165]);
  });

  it('leaves every candidate alone when no applause was detected', () => {
    expect(rejectApplauseCandidates([50, 99, 130], [])).toEqual([50, 99, 130]);
  });
});

/* ---------------------------------------------------------------------------
   PER-NUMBER PRIORS FROM REFERENCE RECORDINGS.

   Per-FORM ranges cannot select an alignment — measured: the old gate held for
   four values of musicEndsAt twelve minutes apart. A reference recording turns
   "a chorus runs 60-420s" into "this chorus runs 450s", which is a target
   rather than a range.
   --------------------------------------------------------------------------- */
describe('matchReference', () => {
  const items = [
    { n: 1, form: 'Sinfonia', incipit: 'Sinfonia' },
    { n: 2, form: 'Recitative', incipit: 'Comfort ye, comfort ye my people,' },
    { n: 3, form: 'Air', incipit: "Ev'ry valley shall be exalted," },
  ];
  const tracks = [
    { title: 'Sinfony (Grave -- Allegro moderato)', seconds: 203 },
    { title: 'Accompagnato (Tenor)- Comfort ye my people', seconds: 205 },
    { title: "Air (Tenor)- Ev'ry valley shall be exalted", seconds: 211 },
  ];

  it('matches a libretto number to its track by the words they share', () => {
    const { expected, report } = matchReference({ items, tracks });
    expect(expected).toEqual([203, 205, 211]);
    expect(report.matched).toBe(3);
  });

  it('sees through a different form prefix and different punctuation', () => {
    const live = [
      { title: 'SINFONY', seconds: 214 },
      { title: 'Recitative, accompanied - Tenor - Comfort ye, my people', seconds: 181 },
      { title: 'Aria - Tenor - Ev’ry Valley shall be exalted', seconds: 203 },
    ];
    expect(matchReference({ items, tracks: live }).expected).toEqual([214, 181, 203]);
  });

  it('leaves a number unmatched rather than guessing at it', () => {
    const { expected, report } = matchReference({
      items: [...items, { n: 4, form: 'Chorus', incipit: 'Something never recorded here' }],
      tracks,
    });
    expect(expected[3]).toBeNull();
    expect(report.unmatched).toEqual(['No. 4 Something never recorded here']);
  });

  /** Each track is spent once: two numbers cannot both claim the same recording. */
  it('never assigns one track to two numbers', () => {
    const dupes = [
      { n: 1, form: 'Chorus', incipit: 'Hallelujah' },
      { n: 2, form: 'Chorus', incipit: 'Hallelujah' },
    ];
    const { expected } = matchReference({ items: dupes, tracks: [{ title: 'Chorus - Hallelujah', seconds: 218 }] });
    expect(expected.filter((e) => e !== null)).toHaveLength(1);
  });
});

describe('reconcileReferences', () => {
  /**
   * TWO SOURCES THAT DISAGREE INFORMATIVELY. The studio album has one 450s track
   * for the closing chorus where the live performance splits it in two
   * (198 + 263 = 461). Those reconcile; averaging them would not.
   */
  it('takes the duration where the two agree', () => {
    const { expected, disputed } = reconcileReferences([450, 402], [461, 424], { tolerance: 0.15 });
    expect(expected[0]).toBe(456);   // (450 + 461) / 2, rounded
    expect(disputed).toEqual([]);
  });

  it('flags a disagreement instead of averaging it into a wrong number', () => {
    const { expected, disputed } = reconcileReferences([450], [198], { tolerance: 0.15 });
    expect(expected[0]).toBeNull();
    expect(disputed).toEqual([0]);
  });

  it('uses whichever source has the number when only one does', () => {
    expect(reconcileReferences([450, null], [null, 424], { tolerance: 0.15 }).expected)
      .toEqual([450, 424]);
  });
});

describe('FORM_DURATIONS', () => {
  // DERIVED FROM THE PARSER, not a hand-kept list: a literal list is how `Soli`
  // stayed recognised by the reader and unpriced by the gate, with a green test.
  it('publishes a prior for every form the reader can recognise', () => {
    for (const form of RECOGNISED_FORMS) {
      expect(FORM_DURATIONS[form], `no prior for ${form}`).toBeDefined();
    }
  });
});

describe('validateSpans', () => {
  const items = [
    { n: 1, form: 'Sinfonia', incipit: 'Sinfonia' },
    { n: 2, form: 'Recitative', incipit: 'Comfort ye' },
    { n: 3, form: 'Air', incipit: "Ev'ry valley" },
  ];

  it('accepts spans whose lengths suit their own forms', () => {
    const r = validateSpans({ items, starts: [0, 180, 250], endS: 500 });
    expect(r.ok).toBe(true);
    expect(r.spans.map((s) => s.seconds)).toEqual([180, 70, 250]);
  });

  it('rejects a recitative that runs six minutes — a missed boundary', () => {
    const r = validateSpans({ items, starts: [0, 180, 540], endS: 800 });
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toMatch(/Recitative/);
  });

  it('says WHICH WAY a span is wrong, because the two need opposite fixes', () => {
    const tooLong = validateSpans({ items, starts: [0, 180, 540], endS: 800 });
    expect(tooLong.failures.join(' ')).toMatch(/too long/);
    const tooShort = validateSpans({ items, starts: [0, 180, 190], endS: 210 });
    expect(tooShort.failures.join(' ')).toMatch(/too short/);
  });

  it('rejects when the starts do not pair positionally with the libretto', () => {
    const r = validateSpans({ items, starts: [0, 180], endS: 500 });
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toMatch(/3 numbers.*2 starts/);
  });

  /**
   * THE CUT. This performance omits roughly a fifth of the work, so an omitted
   * number is an ordinary state, not a failure — it carries a null start, is
   * reported as omitted, and crucially does NOT consume its neighbour's span.
   */
  it('accepts a null start as an omission and does not shift the next number', () => {
    const r = validateSpans({ items, starts: [0, null, 180], endS: 430 });
    expect(r.ok).toBe(true);
    expect(r.spans[1]).toMatchObject({ n: 2, omitted: true, seconds: null });
    expect(r.spans[0].seconds).toBe(180);
    expect(r.spans[2].seconds).toBe(250);
  });

  it('reports how much of the work this performance leaves out', () => {
    const r = validateSpans({ items, starts: [0, null, 180], endS: 430 });
    expect(r.spans.filter((s) => s.omitted).map((s) => s.n)).toEqual([2]);
  });

  /** FAIL CLOSED: an unknown form means the parse was shaky for exactly this number. */
  it('fails a number whose form it cannot price, rather than passing it', () => {
    const odd = [{ n: 1, form: 'Madrigal', incipit: 'x' }];
    const r = validateSpans({ items: odd, starts: [0], endS: 200 });
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toMatch(/no duration prior/);
  });
});

describe('alignLibretto', () => {
  const items = [
    { n: 1, form: 'Sinfonia', incipit: 'Sinfonia' },
    { n: 2, form: 'Recitative', incipit: 'Comfort ye' },
    { n: 3, form: 'Air', incipit: "Ev'ry valley" },
  ];

  it('assigns one candidate per number when they all sound', () => {
    const { starts, report } = alignLibretto({ items, candidates: [0, 180, 250], endS: 500 });
    expect(starts).toEqual([0, 180, 250]);
    expect(report.skipped).toEqual([]);
  });

  it('omits a number rather than forcing an implausible span', () => {
    const { starts, report } = alignLibretto({ items, candidates: [0, 200], endS: 480 });
    expect(starts[1]).toBeNull();
    expect(report.skipped).toEqual(['No. 2 Comfort ye']);
  });

  it('ignores a spurious candidate rather than assigning a number to it', () => {
    // 185 is applause 5s after the real boundary at 180.
    const { starts } = alignLibretto({ items, candidates: [0, 180, 185, 250], endS: 500 });
    expect(starts).toEqual([0, 180, 250]);
  });

  it('feeds an alignment its own checker accepts', () => {
    const { starts } = alignLibretto({ items, candidates: [0, 180, 250], endS: 500 });
    expect(validateSpans({ items, starts, endS: 500 }).ok).toBe(true);
  });

  it('prices a skip so omission is a considered choice, not a free one', () => {
    expect(SKIP_PENALTY).toBeGreaterThan(0);
    expect(spanCost({ form: 'Recitative' }, 60)).toBe(0);        // inside the prior
    expect(spanCost({ form: 'Recitative' }, 400)).toBeGreaterThan(0); // outside it
  });

  /* -------------------------------------------------------------------------
     THE SEARCH MUST OPTIMISE WHAT THE GATE MEASURES.

     `spanCost` grew linearly with the violation, so a span four seconds under
     its floor cost 4 while a skip cost 40 — and the search bought the bad
     candidate every time. But the gate is BINARY: any span outside its prior
     fails, so an alignment containing one is worthless however cheap it looked.
     On the real recording that mismatch produced one omission where the
     duration arithmetic requires eight to twelve.

     So an implausible span is priced far above any number of skips, and the
     magnitude survives only as a tie-break between unavoidable violations.
     ------------------------------------------------------------------------- */
  it('prices ANY implausible span above every skip the work could need', () => {
    const worst = spanCost({ form: 'Recitative' }, 10_000);
    const oneOutside = spanCost({ form: 'Recitative' }, 181);   // 1s over the ceiling
    expect(oneOutside).toBeGreaterThan(53 * SKIP_PENALTY);
    // ...and among violations, less wrong is still preferred.
    expect(worst).toBeGreaterThan(oneOutside);
  });

  it('omits a number rather than accepting a span one second outside its prior', () => {
    // Two candidates, and using the second makes the recitative 1s too long.
    // Skipping it costs SKIP_PENALTY; taking it must cost more.
    const two = [
      { n: 1, form: 'Chorus', incipit: 'A' },
      { n: 2, form: 'Recitative', incipit: 'B' },
    ];
    const { starts } = alignLibretto({ items: two, candidates: [0, 100], endS: 281 });
    expect(starts[1]).toBeNull();
  });
});
