import { describe, it, expect } from 'vitest';
import {
  emptyFlow, pushOnsets, pushReleases, clearIfIdle, flowColumns, flowDurations, columnRolls, baselineOf, classifyIoi,
  GAP_MS, SPAN_MAX_MS, ROLL_MARK_MS, MAX_COLUMN_NOTES, COLUMN_CAPACITY, IDLE_CLEAR_MS, STALE_CLEAR_MS,
  DEFAULT_BASELINE_MS, BASELINE_MIN_MS, BASELINE_MAX_MS, SLOW_RATIO,
} from "./noteFlow.js";

// Helper: play a sequence of [midis, atMs] and return the resulting flow.
const run = (events, opts) =>
  events.reduce((f, [midis, at]) => pushOnsets(f, midis, at, opts), emptyFlow());
const play = (events, opts) => flowColumns(run(events, opts));
// Durations of the CLOSED columns only — the last is provisional and clock-dependent.
const closed = (flow) => flow.columns.map((c) => c.duration).slice(0, -1);

// A key-down surface that says "everything is still held" / "nothing is".
const allHeld = { has: () => true, size: 1 };
const noneHeld = { has: () => false, size: 0 };

describe('noteFlow — simultaneity grouping', () => {
  it('stacks a struck chord into ONE column (jitter inside the window)', () => {
    expect(play([[[48], 0], [[60], 12], [[64], 19], [[67], 28]])).toEqual([[48, 60, 64, 67]]);
  });

  it('stacks an ordinary two-hand chord whose hands land 80ms apart', () => {
    // The case the old 45ms window splintered: close-voiced LH triad, RH triad after.
    // Nearest notes are 5 semitones apart, so no register-based rule would have helped.
    const cols = play([[[48, 52, 55], 0], [[60, 64, 67], 80]], { held: allHeld });
    expect(cols).toEqual([[48, 52, 55, 60, 64, 67]]);
  });

  it('spreads a rolled chord across columns (each note past the window)', () => {
    const step = GAP_MS + 10;
    expect(play([[[60], 0], [[64], step], [[67], 2 * step]])).toEqual([[60], [64], [67]]);
  });

  it('spreads an arpeggio in the order played, not sorted by pitch', () => {
    const step = GAP_MS + 10;
    expect(play([[[67], 0], [[60], step], [[64], 2 * step]])).toEqual([[67], [60], [64]]);
  });

  it('a slow roll whose notes are still held is ONE column', () => {
    expect(play([[[60], 0], [[64], 60], [[67], 120]], { held: allHeld })).toEqual([[60, 64, 67]]);
  });

  it('GAP_MS is measured from the last onset', () => {
    expect(play([[[60], 0], [[64], GAP_MS]])).toEqual([[60, 64]]);
    expect(play([[[60], 0], [[64], GAP_MS + 1]])).toEqual([[60], [64]]);
  });

  it('keeps a 4-note roll at 45ms steps as one chord', () => {
    expect(play([[[60], 0], [[64], 45], [[67], 90], [[72], 135]], { held: allHeld }))
      .toEqual([[60, 64, 67, 72]]);
  });

  it('keeps a late finger at +80ms in the chord', () => {
    expect(play([[[60, 64, 67], 0], [[72], 80]], { held: allHeld })).toEqual([[60, 64, 67, 72]]);
  });

  it('splits a held legato run at SPAN_MAX_MS', () => {
    const ev = [0, 60, 120, 180, 240, 300].map((at, i) => [[60 + i], at]);
    expect(play(ev, { held: allHeld })).toEqual([[60, 61, 62, 63, 64], [65]]);
    expect(SPAN_MAX_MS).toBe(250);
  });

  it('caps a column at MAX_COLUMN_NOTES', () => {
    const ev = Array.from({ length: 20 }, (_, i) => [[40 + i], i * 10]);
    const cols = play(ev, { held: allHeld });
    expect(cols.length).toBeGreaterThan(1);
    cols.forEach((c) => expect(c.length).toBeLessThanOrEqual(MAX_COLUMN_NOTES));
  });

  it('a hymn of rolled chords draws one column per chord', () => {
    const ev = [0, 1, 2, 3].flatMap((k) =>
      [60, 64, 67, 72].map((m, i) => [[m], k * 1000 + i * 40]));
    const flow = run(ev, { held: allHeld });
    expect(flow.columns).toHaveLength(4);
    closed(flow).forEach((d) => expect(['q', 'h']).toContain(d));
  });

  it('sorts within a column (low → high) so noteheads stack in pitch order', () => {
    expect(play([[[67, 60, 64], 0]])).toEqual([[60, 64, 67]]);
  });

  it('re-strike of a note already in the open column starts a new column', () => {
    expect(play([[[60], 0], [[60], 20]])).toEqual([[60], [60]]);
  });

  it('lets the SAME note appear again in a later column (repeated notes are real)', () => {
    expect(play([[[60], 0], [[60], 500]])).toEqual([[60], [60]]);
  });

  it('ignores empty onset batches (a release must not open a column)', () => {
    const flow = pushOnsets(emptyFlow(), [], 100);
    expect(flow.columns).toEqual([]);
    expect(pushOnsets(flow, [], 200)).toBe(flow); // same object → no re-render
  });
});

describe('noteFlow — the key-down overlap test', () => {
  it('does NOT merge inside the window when the earlier note was already released', () => {
    // A detached run at 60ms/note: fast enough to be inside the window, but each key
    // is up before the next lands. Time alone would have fused these into one chord.
    expect(play([[[60], 0], [[64], 60]], { held: noneHeld })).toEqual([[60], [64]]);
  });

  it('merges inside the window when the earlier notes are still down', () => {
    expect(play([[[60], 0], [[64], 60]], { held: allHeld })).toEqual([[60, 64]]);
  });

  it('does not collapse a wide arpeggio that crosses middle C', () => {
    // The regression the earlier register-based design introduced: C2→E3→G4→C6 at
    // 100ms/note drew as [C2], [E3+G4+C6]. Played slower than GAP_MS it must stay four
    // columns (at 100ms, now inside GAP_MS, held keys make it a roll instead).
    const s = GAP_MS + 10;
    const cols = play([[[36], 0], [[52], s], [[67], 2 * s], [[96], 3 * s]], { held: allHeld });
    expect(cols).toEqual([[36], [52], [67], [96]]);
  });

  it('falls back to time alone when no key-down surface is supplied', () => {
    expect(play([[[60], 0], [[64], 60]])).toEqual([[60, 64]]);
  });

  it('requires EVERY note of the column to still be down, not just one', () => {
    const partial = { has: (n) => n === 60, size: 1 };
    expect(play([[[60], 0], [[64], 20], [[67], 60]], { held: partial }))
      .toEqual([[60, 64], [67]]);
  });
});

describe('noteFlow — arrivals', () => {
  const arrivals = (ev) => run(ev, { held: allHeld }).columns.map((c) => c.arrivals);
  it('records each note with its onset time, in arrival order, across joins', () => {
    expect(arrivals([[[72], 0], [[48], 10], [[67], 40], [[52, 55], 80]])).toEqual([[
      { midi: 72, at: 0 }, { midi: 48, at: 10 }, { midi: 67, at: 40 }, { midi: 52, at: 80 }, { midi: 55, at: 80 },
    ]]);
  });
  it('a new column starts its own arrivals', () => {
    expect(arrivals([[[60, 64], 0], [[67], 1000]])).toEqual([
      [{ midi: 60, at: 0 }, { midi: 64, at: 0 }],
      [{ midi: 67, at: 1000 }],
    ]);
  });
  it('never mutates the column it joins', () => {
    const f1 = pushOnsets(emptyFlow(), [60], 0, { held: allHeld });
    const before = f1.columns[0].arrivals;
    pushOnsets(f1, [64], 40, { held: allHeld });
    expect(before).toEqual([{ midi: 60, at: 0 }]);
  });
  it('columnRolls judges each hand on its own arrivals', () => {
    const arrivals = [[79, 0], [48, 10], [76, 60], [52, 70], [72, 120], [55, 150]].map(([midi, at]) => ({ midi, at }));
    expect(columnRolls({ midis: [48, 52, 55, 72, 76, 79], arrivals })).toEqual({ treble: 'down', bass: 'up' });
    expect(columnRolls({ midis: [60, 64, 67], arrivals: [60, 64, 67].map((midi) => ({ midi, at: 0 })) }))
      .toEqual({ treble: null, bass: null });
  });
  it('ROLL_MARK_MS is still the threshold the renderer reads', () => {
    expect(ROLL_MARK_MS).toBe(100);
  });
});

describe('noteFlow — capacity', () => {
  it('scrolls the oldest column off once capacity is exceeded', () => {
    const events = Array.from({ length: COLUMN_CAPACITY + 3 }, (_, i) => [[60 + i], i * 1000]);
    const cols = play(events);
    expect(cols).toHaveLength(COLUMN_CAPACITY);
    expect(cols[0]).toEqual([63]); // first three scrolled off
    expect(cols[cols.length - 1]).toEqual([60 + COLUMN_CAPACITY + 2]);
  });

  it('honours a custom capacity', () => {
    const events = Array.from({ length: 6 }, (_, i) => [[60 + i], i * 1000]);
    expect(play(events, { capacity: 3 })).toEqual([[63], [64], [65]]);
  });

  it('never exceeds capacity even when a single batch is huge', () => {
    const events = Array.from({ length: 40 }, (_, i) => [[40 + i], i * 500]);
    expect(play(events)).toHaveLength(COLUMN_CAPACITY);
  });
});

describe('noteFlow — idle reset', () => {
  it('keeps the line through a breath; the next onset starts a fresh line', () => {
    const flow = pushOnsets(emptyFlow(), [60], 1000);
    expect(clearIfIdle(flow, 1000 + IDLE_CLEAR_MS)).toBe(flow);
    const next = pushOnsets(flow, [64], 1000 + IDLE_CLEAR_MS + 1);
    expect(flowColumns(next)).toEqual([[64]]);
    expect(next.recentIois).toEqual([]);
  });

  it('returns the SAME object when already empty (no idle re-render churn)', () => {
    const flow = emptyFlow();
    expect(clearIfIdle(flow, 999999)).toBe(flow);
  });

  it('a new note after a clear starts again at the left', () => {
    let flow = pushOnsets(emptyFlow(), [60], 0);
    flow = pushOnsets(flow, [64], 500);
    flow = clearIfIdle(flow, 500 + STALE_CLEAR_MS);
    flow = pushOnsets(flow, [67], 9000);
    expect(flowColumns(flow)).toEqual([[67]]);
  });

  it('does NOT wipe a chord that is still being held down', () => {
    // Sitting on a final chord must not erase it — the half note is the whole point.
    const flow = pushOnsets(emptyFlow(), [60, 64, 67], 1000);
    expect(clearIfIdle(flow, 1000 + IDLE_CLEAR_MS, { held: allHeld })).toBe(flow);
  });

  it('empties an abandoned staff after STALE_CLEAR_MS even with a key down', () => {
    const flow = pushOnsets(emptyFlow(), [60], 1000);
    expect(clearIfIdle(flow, 1000 + STALE_CLEAR_MS, { held: allHeld }).columns).toEqual([]);
  });

  it('still accepts a bare number as idleMs (older signature)', () => {
    const flow = pushOnsets(emptyFlow(), [60], 1000);
    expect(clearIfIdle(flow, 1500, 400).columns).toEqual([]);
    expect(clearIfIdle(flow, 1300, 400)).toBe(flow);
  });

  it('clears the baseline history along with the columns', () => {
    let flow = run([[[60], 0], [[64], 400], [[67], 800]]);
    expect(flow.recentIois.length).toBeGreaterThan(0);
    expect(clearIfIdle(flow, 800 + STALE_CLEAR_MS).recentIois).toEqual([]);
  });
});

describe('noteFlow — baseline', () => {
  it('uses the default when nothing has been measured yet', () => {
    expect(baselineOf([])).toBe(DEFAULT_BASELINE_MS);
  });

  it('clamps a very fast passage up to the floor', () => {
    expect(baselineOf([120, 120, 120])).toBe(BASELINE_MIN_MS);
  });

  it('clamps a very slow passage down to the ceiling', () => {
    expect(baselineOf([2000, 2000, 2000])).toBe(BASELINE_MAX_MS);
  });

  it('keeps the half threshold clear of the idle wipe at every legal baseline', () => {
    // If SLOW_RATIO × baseline ever reached IDLE_CLEAR_MS, no half could draw.
    expect(SLOW_RATIO * BASELINE_MAX_MS).toBeLessThan(IDLE_CLEAR_MS);
  });

  it('takes the median, so one long pause does not drag the scale', () => {
    expect(baselineOf([400, 400, 5000, 400])).toBe(400);
  });

  it('remembers further back than the staff can show', () => {
    // Nine columns at 400ms: the first has scrolled off, its gap still counts.
    const flow = run(Array.from({ length: 9 }, (_, i) => [[60 + i], i * 400]));
    expect(flow.columns.length).toBe(COLUMN_CAPACITY);
    expect(flow.recentIois.length).toBe(8);
  });
});

describe('noteFlow — duration classification', () => {
  it('classifies against the ratios', () => {
    expect(classifyIoi(100, 500)).toBe('8');   // < 0.6 × 500
    expect(classifyIoi(500, 500)).toBe('q');
    expect(classifyIoi(800, 500)).toBe('h');   // > 1.5 × 500
  });

  it('draws a fast run from silence as eighths all the way through', () => {
    // The failure the baseline floor exists to prevent: with a purely relative
    // baseline, a uniform 120ms run normalises to itself and reads as quarters.
    const flow = run(Array.from({ length: 8 }, (_, i) => [[60 + i], i * 120]), { held: noneHeld });
    expect(closed(flow)).toEqual(['8', '8', '8', '8', '8', '8', '8']);
  });

  it('draws ordinary playing as quarters', () => {
    const flow = run(Array.from({ length: 6 }, (_, i) => [[60 + i], i * 500]));
    expect(closed(flow)).toEqual(['q', 'q', 'q', 'q', 'q']);
  });

  it('a uniform 250ms passage is uniform from the first gap', () => {
    const flow = run(Array.from({ length: 6 }, (_, i) => [[60 + i], i * 250]), { held: noneHeld });
    expect(closed(flow)).toEqual(['q', 'q', 'q', 'q', 'q']);
  });

  it('gives a long gap a half note', () => {
    const flow = run([[[60], 0], [[64], 900]]);
    expect(closed(flow)).toEqual(['h']);
  });

  it('reads a burst against its context: same notes, eighths only after slow playing', () => {
    const fast = [[[72], 2000], [[74], 2000 + GAP_MS + 20]];
    const fromSlow = run([[[60], 0], [[62], 600], [[64], 1200], ...fast]);
    expect(closed(fromSlow).slice(-1)).toEqual(['8']);
  });

  it('does NOT rewrite the duration of a column already on the staff', () => {
    // Play steadily, then break into a run. The steady quarters must stay quarters
    // even though the run drags the baseline down underneath them.
    const steady = Array.from({ length: 4 }, (_, i) => [[60 + i], i * 400]);
    const before = closed(run(steady));
    const after = closed(run([...steady, [[72], 1520], [[74], 1640], [[76], 1760]]));
    expect(after.slice(0, before.length)).toEqual(before);
    expect(before).toEqual(['q', 'q', 'q']);
  });
});

describe('noteFlow — the provisional newest column', () => {
  it('shows a quarter the moment it is struck', () => {
    const flow = pushOnsets(emptyFlow(), [60], 0);
    expect(flowDurations(flow, 0)).toEqual(['q']);
  });

  it('promotes itself to a half once held past the threshold', () => {
    const flow = pushOnsets(emptyFlow(), [60], 0);
    const threshold = SLOW_RATIO * DEFAULT_BASELINE_MS;
    expect(flowDurations(flow, threshold - 1)).toEqual(['q']);
    expect(flowDurations(flow, threshold + 1)).toEqual(['h']);
  });

  it('promotes before the idle wipe would take it (the half is actually visible)', () => {
    expect(SLOW_RATIO * DEFAULT_BASELINE_MS).toBeLessThan(IDLE_CLEAR_MS);
  });

  it('leaves closed columns alone while the newest one promotes', () => {
    const flow = run([[[60], 0], [[64], 500]]);
    expect(flowDurations(flow, 500)).toEqual(['q', 'q']);
    expect(flowDurations(flow, 500 + SLOW_RATIO * 500 + 1)).toEqual(['q', 'h']);
  });

  it('returns one duration per column', () => {
    const flow = run(Array.from({ length: 5 }, (_, i) => [[60 + i], i * 300]));
    expect(flowDurations(flow, 1200)).toHaveLength(flowColumns(flow).length);
  });
});

describe('noteFlow — immutability', () => {
  it('never mutates the flow it is given', () => {
    const flow = pushOnsets(emptyFlow(), [60], 0);
    const snapshot = JSON.stringify(flow);
    pushOnsets(flow, [64], 1000);
    pushOnsets(flow, [64], 10);
    clearIfIdle(flow, 999999);
    flowDurations(flow, 5000);
    const two = pushOnsets(flow, [64], 300, { held: allHeld });
    const twoSnap = JSON.stringify(two);
    pushReleases(two, 400, noneHeld);
    expect(JSON.stringify(two)).toBe(twoSnap);
    expect(JSON.stringify(flow)).toBe(snapshot);
  });
});

describe('noteFlow — holds (pushReleases)', () => {
  const setOf = (...ns) => new Set(ns);
  // Build a flow, passing the held surface that was true at each onset.
  const runHeld = (events) => events.reduce((f, [m, at, h]) => pushOnsets(f, m, at, { held: h }), emptyFlow());

  it('a LH chord held under a RH melody promotes to a half', () => {
    const lh = [48, 52, 55];
    const flow = runHeld([
      [lh, 0, setOf(...lh)],
      [[72], 250, setOf(...lh, 72)],
      [[74], 500, setOf(...lh, 72, 74)],   // RH legato: previous note still down
      [[76], 750, setOf(...lh, 74, 76)],
    ]);
    // IOIs 250,250,250 -> baseline clamps to 300 -> threshold 450 < 900: wide margin.
    expect(flow.columns[0].heldAtClose).toBe(true);
    expect(flowDurations(flow, 900)[0]).toBe('h');
  });

  it('a column released before the next onset keeps its IOI duration', () => {
    const flow = runHeld([[[60], 0, setOf(60)], [[64], 400, setOf(64)]]);
    expect(flow.columns[0].heldAtClose).toBe(false);
    expect(flowDurations(flow, 5000)[0]).toBe('q');
  });

  it('release freezes the duration', () => {
    let flow = runHeld([[[60], 0, setOf(60)], [[64], 400, setOf(60, 64)]]);
    flow = pushReleases(flow, 400 + 0, setOf(64)); // 60 let go at 400
    expect(flow.columns[0].releasedAt).toBe(400);
    expect(flow.columns[0].duration).toBe('q');
    expect(flowDurations(flow, 5000)[0]).toBe('q');
  });

  it('a re-strike of the same pitch releases the earlier column', () => {
    let flow = runHeld([[[60], 0, setOf(60)], [[60], 400, setOf(60)]]);
    expect(flow.columns[0].heldAtClose).toBe(true);
    flow = pushReleases(flow, 400, setOf(60));
    expect(flow.columns[0].releasedAt).toBe(400);
  });

  it('a column struck with both hands stays a half while the LH holds', () => {
    let flow = runHeld([
      [[48], 0, setOf(48)],
      [[72], 50, setOf(48, 72)],            // joins: one column [48,72]
      [[74], 300, setOf(48, 72, 74)],       // RH moves on legato
    ]);
    expect(flowColumns(flow)[0]).toEqual([48, 72]);
    expect(flowDurations(flow, 1000)[0]).toBe('h'); // baseline 300 -> 450 threshold
    flow = pushReleases(flow, 2000, setOf(74));
    expect(flowDurations(flow, 2000)[0]).toBe('h');
    expect(flowDurations(flow, 9000)[0]).toBe('h');
  });

  it('returns the same flow when nothing was released', () => {
    const flow = runHeld([[[60], 0, setOf(60)], [[64], 400, setOf(60, 64)]]);
    expect(pushReleases(flow, 500, setOf(60, 64))).toBe(flow);
  });
});

describe('noteFlow — legato is not a roll (release-based split)', () => {
  // Replay a raw key stream the way the staff sees it: every event pushes its onset
  // (with the key-down surface as it stands) and then runs pushReleases.
  const stream = (events, opts = {}) => {
    const held = new Set();
    let flow = emptyFlow();
    for (const [type, midi, at] of [...events].sort((a, b) => a[2] - b[2])) {
      if (type === 'on') { held.add(midi); flow = pushOnsets(flow, [midi], at, { held, ...opts }); }
      else held.delete(midi);
      flow = pushReleases(flow, at, held, opts);
    }
    return flow;
  };

  it('an 80ms legato C-D-E-F, each let go 30ms after the next lands, is four columns', () => {
    const notes = [60, 62, 64, 65];
    const events = notes.flatMap((m, i) => [
      ['on', m, i * 80],
      ['off', m, i < notes.length - 1 ? (i + 1) * 80 + 30 : 1000],
    ]);
    const flow = stream(events);
    expect(flowColumns(flow)).toEqual([[60], [62], [64], [65]]);
    // Each split column keeps arrivals parallel to midis, and opens at its own arrival.
    flow.columns.forEach((c, i) => {
      expect(c.arrivals.map((a) => a.midi)).toEqual(c.midis);
      expect(c.startedAt).toBe(i * 80);
    });
    // The split inserted the gaps pushOnsets would have recorded, and judged them alike.
    expect(flow.recentIois).toEqual([80, 80, 80]);
    expect(closed(flow)).toEqual(['8', '8', '8']);
  });

  it('a four-note roll at 120ms steps, held a second, stays one column', () => {
    const notes = [48, 55, 60, 64];
    const events = notes.flatMap((m, i) => [['on', m, i * 120], ['off', m, 360 + 1000]]);
    // 360ms from first to last is past SPAN_MAX_MS, a separate rule; lifted here so
    // this pins only that holding every key keeps the release rule from splitting it.
    const flow = stream(events, { spanMs: 400 });
    expect(flowColumns(flow)).toEqual([notes]);
  });

  it('a two-hand chord whose right hand lands 140ms after the left, all held, stays one column', () => {
    const lh = [43, 50, 55]; const rh = [67, 71, 74];
    const events = [
      ...lh.map((m) => ['on', m, 0]), ...rh.map((m) => ['on', m, 140]),
      ...[...lh, ...rh].map((m) => ['off', m, 1200]),
    ];
    const flow = stream(events);
    expect(flowColumns(flow)).toEqual([[...lh, ...rh]]);
  });

  it('a struck chord let go at once is not legato, however short', () => {
    // Keys 10ms apart, all up 60ms later: inside LEGATO_RELEASE_MS, but one strike.
    const events = [[60, 0], [64, 10], [67, 20]].flatMap(([m, at]) => [['on', m, at], ['off', m, 80]]);
    expect(flowColumns(stream(events))).toEqual([[60, 64, 67]]);
  });

  it('one finger lifting early does not split a chord the others still hold', () => {
    // C and E struck, G rolled in 60ms later; C lets go 40ms after G, E stays down.
    const flow = stream([['on', 60, 0], ['on', 64, 10], ['on', 67, 70], ['off', 60, 110], ['off', 64, 900], ['off', 67, 900]]);
    expect(flowColumns(flow)).toEqual([[60, 64, 67]]);
  });

  it('the release threshold and step floor can be overridden (the sweep does)', () => {
    const notes = [60, 62];
    const events = [['on', 60, 0], ['on', 62, 80], ['off', 60, 200], ['off', 62, 900]];
    expect(flowColumns(stream(events))).toEqual([[60], [62]]);               // 120 <= 160
    expect(flowColumns(stream(events, { legatoReleaseMs: 100 }))).toEqual([notes]);
    expect(flowColumns(stream(events, { legatoMinStepMs: 90 }))).toEqual([notes]);
    expect(flowColumns(stream(events, { liftTogetherMs: 800 }))).toEqual([notes]);
  });

  it('splits the second-newest column once the lift window has shown D still down', () => {
    // One React batch at 115: C lets go and E lands. E cannot join (C is up), so it
    // closes [C D]. Whether C and D were lifted together is not known yet at 115; the
    // next key event (D still down at 150) settles it, and [C D] is second-newest then.
    let flow = pushOnsets(emptyFlow(), [60], 0, { held: new Set([60]) });
    flow = pushOnsets(flow, [62], 80, { held: new Set([60, 62]) });
    flow = pushOnsets(flow, [64], 115, { held: new Set([62, 64]) });
    flow = pushReleases(flow, 115, new Set([62, 64]));
    expect(flowColumns(flow)).toEqual([[60, 62], [64]]);
    flow = pushReleases(flow, 150, new Set([62, 64]));
    expect(flowColumns(flow)).toEqual([[60], [62], [64]]);
    expect(flow.columns.map((c) => c.startedAt)).toEqual([0, 80, 115]);
    // The [C D] gap of 115 is replaced by the two gaps the split exposes.
    expect(flow.recentIois).toEqual([80, 35]);
  });

  it('a staccato roll lifted all at once stays one column', () => {
    const events = [[60, 0], [64, 40], [67, 80]].flatMap(([m, at]) => [['on', m, at], ['off', m, 200]]);
    expect(flowColumns(stream(events))).toEqual([[60, 64, 67]]);
  });

  it('a two-hand staccato chord, right hand 40ms late, all lifted at once, stays one column', () => {
    const events = [
      ['on', 48, 0], ['on', 52, 0], ['on', 72, 40], ['on', 76, 40],
      ...[48, 52, 72, 76].map((m) => ['off', m, 150]),
    ];
    expect(flowColumns(stream(events))).toEqual([[48, 52, 72, 76]]);
  });

  it('a struck chord records no releases (no re-render on key-up)', () => {
    let flow = pushOnsets(emptyFlow(), [60], 0, { held: new Set([60]) });
    flow = pushOnsets(flow, [64], 10, { held: new Set([60, 64]) });
    expect(pushReleases(flow, 300, new Set([64]))).toBe(flow);
  });

  it('a note released long after the next landed is a held chord, not legato', () => {
    const flow = stream([['on', 60, 0], ['on', 64, 60], ['off', 60, 400], ['off', 64, 500]]);
    expect(flowColumns(flow)).toEqual([[60, 64]]);
  });

  it('respects capacity when a split adds a column', () => {
    let flow = emptyFlow();
    for (let i = 0; i < 3; i += 1) flow = pushOnsets(flow, [40 + i], i * 400, { held: new Set([40 + i]), capacity: 3 });
    flow = pushOnsets(flow, [60], 1200, { held: new Set([60]), capacity: 3 });
    flow = pushOnsets(flow, [62], 1280, { held: new Set([60, 62]), capacity: 3 });
    flow = pushReleases(flow, 1300, new Set([62]), { capacity: 3 });
    flow = pushReleases(flow, 1340, new Set([62]), { capacity: 3 }); // 62 outlasts the lift window
    expect(flowColumns(flow)).toEqual([[41], [42], [60], [62]].slice(-3));
  });

  it('returns the same flow when no young column lost a key', () => {
    const flow = stream([['on', 60, 0], ['on', 64, 40]]);
    expect(pushReleases(flow, 100, new Set([60, 64]))).toBe(flow);
  });

  it('never mutates its input', () => {
    let flow = pushOnsets(emptyFlow(), [60], 0, { held: new Set([60]) });
    flow = pushOnsets(flow, [62], 80, { held: new Set([60, 62]) });
    const snapshot = JSON.stringify(flow);
    pushReleases(flow, 110, new Set([62]));
    expect(JSON.stringify(flow)).toBe(snapshot);
  });
});
