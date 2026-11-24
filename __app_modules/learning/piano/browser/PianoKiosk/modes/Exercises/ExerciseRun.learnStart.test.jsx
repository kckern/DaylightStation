import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExerciseRun, { CLICK_PREROLL_MS, MAX_CUE_RESTARTS } from './ExerciseRun.jsx';
import fourBars from './__fixtures__/fourBars.musicxml?raw';

/**
 * PART A OF THE LEARN TIMING SPEC (2026-11-20), on the real engine path: a cued
 * Learn passage (`surface="learn-lab"`, score material) arms on a key, starts
 * its count-in only once that key is up (or a second later) and a gap after,
 * counts UP with the clicks, and names a steady take shifted by a whole beat.
 * The harness below is ExerciseRun.score.test.jsx's: the engraver is doubled,
 * the expectation and the grading are real.
 *
 * Bars 2–3 of the fixture are E4 F4 G4 A4 in half notes at 80 bpm: the ask's
 * pulse is a half note, so the count-in is four clicks 1500 ms apart (lead-in
 * 6000 ms), each note is judged ±400 ms, and "one beat" is one click (1500 ms).
 *
 * The `score` material kind, end to end through the run surface: a gate hands
 * `ExerciseRun` a passage of real sheet music instead of a bank instance, and
 * everything downstream — the attempt, the cursor, the verdict — comes from the
 * ENGRAVING rather than from an authored event list.
 *
 * Two boundaries are doubled and each for a stated reason:
 *
 *  - `MusicXmlRenderer`, because OpenSheetMusicDisplay cannot engrave under
 *    happy-dom (no SVG text metrics; it lands on its own "Could not read this
 *    score." placeholder and never publishes a layout — verified against the
 *    known-good `maryHadALittleLamb` fixture as well as this suite's). This is
 *    the same double `modes/SheetMusic/ScorePlayer.test.jsx` uses. The
 *    real-engraving assertion belongs to the Chromium scenario.
 *  - `DaylightAPIText`, because the score is a file on the media tree.
 *
 * NOTHING about the grading is doubled: the expectation is compiled by the real
 * `compileScoreExpectation` and graded by the real attempt engine.
 */
const h = vi.hoisted(() => ({
  activeNotes: new Map(),
  record: vi.fn(),
  createAttempt: vi.fn(),
  prepareExercise: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  text: vi.fn(),
  steps: null,
  /** Reproduce the placeholder state: OSMD threw, no layout is ever published. */
  engraveFails: false,
  /** The engraver's bar map for the shown bars; null = the renderer reported none. */
  measureMap: null,
  /** Quarters added to every shown onset: a passage that opens on a rest. */
  onsetShift: 0,
  /** The metronome hook's latest arguments: where the click grid is anchored. */
  click: null,
  /** Raw MIDI listeners (the pedals arrive here as control-change bytes). */
  raw: new Set(),
  subscribeRaw: (fn) => { h.raw.add(fn); return () => h.raw.delete(fn); },
}));

const notehead = (midi) => {
  const el = document.createElement('span');
  el.className = 'mock-notehead';
  el.dataset.midi = String(midi);
  document.body.appendChild(el);
  return el;
};

/** bar 1: C4 D4 · bar 2: E4 F4 · bar 3: G4 A4 · bar 4: B4 C5 */
const fourBarSteps = () => [60, 62, 64, 65, 67, 69, 71, 72].map((midi, index) => ({
  onsetQuarter: index * 2,
  measure: Math.floor(index / 2),
  number: Math.floor(index / 2) + 1,
  notes: [{ midi, staff: 0, durationQuarters: 2, el: notehead(midi) }],
}));

vi.mock('../../../../../../../frontend/src/lib/logging/Logger.js', () => ({ default: () => ({ child: () => h.log }) }));
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ connected: true, subscribeRaw: h.subscribeRaw }),
  usePianoMidiNotes: () => ({ activeNotes: h.activeNotes }),
}));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: 'learner4' }) }));
vi.mock('../../../components/PianoKeyboard.jsx', () => ({
  PianoKeyboard: ({ startNote, endNote, targetNotes }) => <div data-testid="keyboard"
    data-range={`${startNote}-${endNote}`}
    data-target={[...(targetNotes ?? new Map()).keys()].join(',')} />,
}));
// NO `pianoLearningApi` DOUBLE: this surface no longer reaches the bank for
// anything. `DaylightAPIText` is still doubled, and that one has teeth — the
// media tree is where a score WOULD be fetched from, and `h.text` never being
// called is the assertion that this run fetches nothing (`AskSession` did).
vi.mock('../SheetMusic/useMetronomeClick.js', () => ({ useMetronomeClick: (args) => { h.click = args; } }));
vi.mock('../../../../../../../frontend/src/lib/api.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  DaylightAPIText: h.text,
}));
vi.mock("../../../../../../../__capabilities/music-notation/browser/renderers/MusicXmlRenderer.jsx", async () => {
  const { useEffect } = await import('react');
  return {
    MusicXmlRenderer: ({ musicXml, onLayout, onReady, onFailed, children }) => {
      useEffect(() => {
        if (h.engraveFails) { onFailed?.({ error: 'Could not read this score.' }); return; }
        const shownNumbers = [...new DOMParser().parseFromString(musicXml, 'application/xml')
          .querySelectorAll('part:first-of-type > measure')]
          .map((measure) => Number(measure.getAttribute('number')))
          .filter(Number.isFinite);
        const shown = h.steps.filter((step) => shownNumbers.includes(step.number));
        const firstOnset = shown[0]?.onsetQuarter ?? 0;
        const firstMeasure = shown[0]?.measure ?? 0;
        const localSteps = shown.map((step) => ({
          ...step,
          onsetQuarter: step.onsetQuarter - firstOnset + h.onsetShift,
          measure: step.measure - firstMeasure,
        }));
        onLayout?.({
          width: 800, height: 300, flow: 'wrapped', scale: 1, transpose: 0,
          tempoEntries: [], measures: shownNumbers.map((_, index) => index), events: [], notes: [], steps: localSteps,
          ...(h.measureMap ? { measureMap: h.measureMap } : {}),
        });
        onReady?.();
        // `onFailed` is held in a ref by the real renderer, not a dep — mirrored.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [musicXml, onLayout, onReady]);
      return <div data-testid="engraver" className="musicxml-renderer"><div className="musicxml-renderer__svg" />{children}</div>;
    },
  };
});
vi.mock('../../../performance/attemptEvidence.js', async (importOriginal) => ({
  ...(await importOriginal()),
  pianoAttemptClient: { record: h.record },
}));
// Both spies pass THROUGH to the real engine — what is pinned is which of the
// two the score path calls, not what either of them does.
vi.mock('../../../performance/assessmentSession.js', async (importOriginal) => {
  const actual = await importOriginal();
  h.createAttempt.mockImplementation(actual.createAssessmentAttempt);
  return { ...actual, createAssessmentAttempt: (...args) => h.createAttempt(...args) };
});
vi.mock('./assessment.js', async (importOriginal) => {
  const actual = await importOriginal();
  h.prepareExercise.mockImplementation(actual.prepareExerciseAssessment);
  return { ...actual, prepareExerciseAssessment: (...args) => h.prepareExercise(...args) };
});

const SOURCE = 'files:docs/sheet-music/four-bars.musicxml';
const BEAT = 1500;
const LEAD_IN = 4 * BEAT;
const GAP = 600; // a missed-cue restart's pre-roll: min(one click, 600 ms)
const PASSAGE = [64, 65, 67, 69];
const settledScore = () => Object.freeze({ id: SOURCE, musicXml: fourBars, measures: [2, 3] });
const learnRequirement = { mode: 'cued', rubric: { id: 'learn-passage-v1', version: '1', criteria: { completeness: 1, cleanliness: 0.8, placement: 0.8 } } };
const props = (over = {}) => ({
  intent: 'practice', instance: null, score: settledScore(), requirement: null,
  practiceMode: 'cued', practiceRequirement: learnRequirement, tier: 2,
  surface: 'learn-lab', failurePresentation: 'local', onFailed: vi.fn(), onPassed: vi.fn(),
  ...over,
});

let view;
let current;
const rerender = () => view.rerender(<ExerciseRun {...current} />);
const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });
/** Keys down now (stamped now, as the MIDI store does); keys already down keep their stamp. */
const hold = (midis) => act(() => {
  const before = h.activeNotes;
  h.activeNotes = new Map(midis.map((midi) => [midi, before.get(midi) ?? { velocity: 1, timestamp: Date.now() }]));
  rerender();
});
const strike = (midi) => { hold([midi]); advance(80); hold([]); };
const run = () => document.querySelector('.piano-exercise-run');
/** A control change, as the bridge delivers it. */
const cc = (controller, value) => act(() => { for (const fn of [...h.raw]) fn({ data: new Uint8Array([0xb0, controller, value]), time: Date.now() }); });
const band = () => document.querySelector('.piano-learn-countin');
const events = (name) => h.log.info.mock.calls.filter(([event]) => event === name).map(([, data]) => data);

async function mount(over = {}) {
  current = props(over);
  view = render(<ExerciseRun {...current} />);
  await screen.findByText(/Press any key to start/);
  // The run is engraved and ready on real timers; the clock is faked from here.
  vi.useFakeTimers({ now: Date.now() });
}

/** Start with a quick tap: the press is beat one, so the count's first click IS the press. */
function armByTap() {
  const pressedAt = Date.now();
  strike(55);
  const started = events('piano.exercise-countdown-started').at(-1);
  expect(started).toMatchObject({ reason: 'arming-key', downbeat: true });
  return pressedAt;
}

/** Play the passage at `offset` from each target (first target = first click + lead-in). */
function playAt(firstClick, offset, pitches = PASSAGE) {
  pitches.forEach((midi, index) => {
    advance(firstClick + LEAD_IN + index * BEAT + offset - Date.now());
    strike(midi);
  });
}
const finish = () => advance(4 * BEAT);

beforeEach(() => {
  document.body.innerHTML = '';
  h.raw.clear();
  h.activeNotes = new Map();
  h.steps = fourBarSteps();
  h.engraveFails = false;
  h.measureMap = null;
  h.onsetShift = 0;
  h.text.mockReset();
  h.text.mockResolvedValue(fourBars);
  h.record.mockReset();
  h.record.mockResolvedValue({ ok: true, status: 201, data: { attempt_id: 'stored' }, durationMs: 4 });
  for (const logger of Object.values(h.log)) logger.mockClear();
});
afterEach(() => { view?.unmount(); view = null; vi.useRealTimers(); });

describe('a key on the piano is beat one of the count (A1)', () => {
  it('a key on the piano is beat one: the count shows 1 at once and the first note is due four clicks after the press', async () => {
    await mount();
    const pressedAt = Date.now();
    hold([55]);
    expect(events('piano.exercise-countdown-started')).toEqual([expect.objectContaining({ reason: 'arming-key', downbeat: true, prerollMs: 0 })]);
    expect(run()).toHaveAttribute('data-phase', 'countdown');
    expect(band()).toHaveAttribute('data-count', '1');
    hold([]);
    advance(BEAT);
    expect(band()).toHaveAttribute('data-count', '2');
    // The passage played on the grid the press began passes.
    PASSAGE.forEach((midi, index) => { advance(pressedAt + LEAD_IN + index * BEAT + 20 - Date.now()); strike(midi); });
    finish();
    advance(1000);
    expect(current.onPassed).toHaveBeenCalledTimes(1);
  });

  it('the press is not sounded again: the click grid is anchored at the press, its first beat already past', async () => {
    await mount();
    const pressedAt = Date.now();
    hold([55]);
    expect(h.click.anchorMs).toBe(pressedAt);
  });

  it('the count starts at the note-on\'s own MIDI time, not when the run got round to seeing it', async () => {
    await mount();
    // The bridge stamped the key 120 ms before the render that saw it.
    const pressedAt = Date.now() - 120;
    act(() => { h.activeNotes = new Map([[55, { velocity: 1, timestamp: pressedAt }]]); rerender(); });
    expect(events('piano.exercise-armed').at(-1)).toMatchObject({ at: pressedAt, downbeat: true });
    expect(h.click.anchorMs).toBe(pressedAt);
    hold([]);
    // The grid is the press's: notes on it pass.
    PASSAGE.forEach((midi, index) => { advance(pressedAt + LEAD_IN + index * BEAT + 20 - Date.now()); strike(midi); });
    finish();
    advance(1000);
    expect(current.onPassed).toHaveBeenCalledTimes(1);
  });

  it('a stamp from the future or long ago is not trusted: the count starts when the run saw the key', async () => {
    await mount();
    const seenAt = Date.now();
    act(() => { h.activeNotes = new Map([[55, { velocity: 1, timestamp: seenAt - 60000 }]]); rerender(); });
    expect(events('piano.exercise-armed').at(-1)).toMatchObject({ at: seenAt });
  });

  it('a second key during the count is not graded and does not start it again', async () => {
    await mount();
    hold([55]);
    advance(400);
    hold([55, 60]);
    expect(events('piano.exercise-countdown-started')).toHaveLength(1);
    expect(events('piano.exercise-input-ignored').at(-1)).toMatchObject({ reason: 'countdown', ignored: [60] });
  });

  it('a missed-cue restart keeps the pre-roll and all four clicks', async () => {
    await mount();
    const pressedAt = armByTap();
    advance(pressedAt + LEAD_IN + 700 - Date.now());
    advance(1000);
    const restart = events('piano.exercise-countdown-started').at(-1);
    expect(restart).toMatchObject({ reason: 'missed-cue', downbeat: false, pulseCount: 4 });
    expect(restart.prerollMs).toBeGreaterThanOrEqual(CLICK_PREROLL_MS);
  });

  it('keeps the old immediate start, countdown and PLAY for a cued score outside Learn', async () => {
    await mount({ surface: 'default' });
    hold([55]);
    expect(run()).not.toHaveAttribute('data-count-style');
    expect(run()).toHaveAttribute('data-phase', 'countdown');
    expect(events('piano.exercise-countdown-started')).toEqual([expect.objectContaining({ reason: 'arming-key' })]);
    expect(band()).toBeNull();
    advance(400);
    expect(document.querySelector('.piano-score-countin__beat')).toHaveTextContent('4');
  });
});

describe('a pedal is any key: it starts the count, and every press is logged', () => {
  it('a sustain press on a prepared cued take starts the count with the press as beat one', async () => {
    await mount();
    const pressedAt = Date.now();
    cc(64, 127);
    expect(events('piano.exercise-countdown-started')).toEqual([expect.objectContaining({ reason: 'pedal', downbeat: true, prerollMs: 0 })]);
    expect(h.click.anchorMs).toBe(pressedAt);
    expect(events('piano.exercise-pedal')).toEqual([expect.objectContaining({ controller: 64, value: 127, acted: 'start', ignored: null })]);
  });

  it('a held or half pedal acts once, and a pedal during the count is logged as ignored', async () => {
    await mount();
    cc(64, 127);
    cc(64, 100);
    cc(64, 0);
    cc(64, 127);
    expect(events('piano.exercise-countdown-started')).toHaveLength(1);
    expect(events('piano.exercise-pedal')).toEqual([
      expect.objectContaining({ acted: 'start' }),
      expect.objectContaining({ acted: null, ignored: 'counting' }),
    ]);
  });

  it('a pedal during the take after the count is logged as ignored while playing', async () => {
    await mount();
    const pressedAt = Date.now();
    cc(64, 127);
    cc(64, 0);
    advance(BEAT);
    cc(64, 127);
    cc(64, 0);
    advance(pressedAt + LEAD_IN + 100 - Date.now());
    cc(64, 127);
    expect(events('piano.exercise-pedal').map(({ acted, ignored }) => [acted, ignored])).toEqual([
      ['start', null], [null, 'counting'], [null, 'playing'],
    ]);
  });

  it('soft and sostenuto (CC 66, 67) start it too; CC 7 does nothing', async () => {
    await mount();
    cc(7, 127);
    expect(events('piano.exercise-countdown-started')).toHaveLength(0);
    expect(events('piano.exercise-pedal')).toHaveLength(0);
    cc(66, 127);
    expect(events('piano.exercise-countdown-started')).toEqual([expect.objectContaining({ reason: 'pedal' })]);
    view.unmount();
    vi.useRealTimers();
    for (const logger of Object.values(h.log)) logger.mockClear();
    await mount();
    cc(67, 127);
    expect(events('piano.exercise-countdown-started')).toEqual([expect.objectContaining({ reason: 'pedal' })]);
  });
});

describe('a cued Learn passage counts up with the clicks (A2)', () => {
  it('shows 1 2 3 4, "next click: play" on the last click, and nothing on the first beat', async () => {
    await mount();
    expect(run()).toHaveAttribute('data-count-style', 'up');
    const firstClick = armByTap();
    const seen = [];
    for (const offset of [100, BEAT + 100, 2 * BEAT + 100, 3 * BEAT + 100]) {
      advance(firstClick + offset - Date.now());
      seen.push([band().dataset.count, band().querySelector('.piano-learn-countin__cue').textContent]);
    }
    // The press itself is click 1; until the last click the band says where to come in.
    expect(seen).toEqual([['1', 'Play on the ♩'], ['2', 'Play on the ♩'], ['3', 'Play on the ♩'], ['4', 'next click: play']]);
    // The note box sits after the four count boxes from the first click.
    expect(band().querySelectorAll('.piano-learn-countin__pip')).toHaveLength(5);
    advance(firstClick + LEAD_IN + 60 - Date.now());
    expect(band()).toBeNull();
    expect(document.querySelector('.piano-score-countin')).toBeNull();
    expect(run().textContent).not.toMatch(/PLAY/);
  });
});

describe('a cued Learn passage arms safely around its own notes and controls', () => {
  it('a held arming key (the first pitch) is ignored until re-struck', async () => {
    await mount();
    const pressedAt = Date.now();
    hold([64]);
    expect(events('piano.exercise-countdown-started')).toEqual([expect.objectContaining({ reason: 'arming-key', downbeat: true })]);
    advance(pressedAt + LEAD_IN - 300 - Date.now());
    hold([]);
    PASSAGE.forEach((midi, index) => { advance(pressedAt + LEAD_IN + index * BEAT + 20 - Date.now()); strike(midi); });
    finish();
    expect(events('piano.exercise-timing-summary').at(-1)).toMatchObject({ entryShiftBeats: null });
    advance(1000);
    expect(current.onPassed).toHaveBeenCalledTimes(1);
    expect(current.onFailed).not.toHaveBeenCalled();
  });

  it('a key while paused starts nothing; after resume a key starts the count', async () => {
    await mount({ maxCueRestarts: 0 });
    act(() => { current = { ...current, paused: true }; rerender(); });
    strike(55);
    advance(3000);
    expect(events('piano.exercise-countdown-started')).toHaveLength(0);
    act(() => { current = { ...current, paused: false }; rerender(); });
    armByTap();
    expect(events('piano.exercise-countdown-started')).toHaveLength(1);
  });

  it('does not delay the result of an ordinary failed take', async () => {
    await mount();
    const firstClick = armByTap();
    PASSAGE.forEach((midi, index) => {
      advance(firstClick + LEAD_IN + index * BEAT + 20 - Date.now());
      strike(index === 1 ? 61 : midi);
    });
    advance(firstClick + LEAD_IN + 4 * BEAT + 100 - Date.now());
    expect(document.querySelector('.piano-exercise-run__result')).not.toBeNull();
    expect(events('piano.exercise-timing-summary').at(-1)).toMatchObject({ entryShiftBeats: 0 });
  });
});

describe('a cued Learn passage names a whole-beat shifted entry (A3)', () => {

  it('names a steady take one beat late (+1), waiting for its last note', async () => {
    await mount({ maxCueRestarts: 0 });
    const firstClick = armByTap();
    playAt(firstClick, BEAT + 120, PASSAGE.slice(0, 3));
    // The passage's own time is over (the last half note ends at target 3 + 1500)
    // but the opening sat a beat late, so the result waits for the last note.
    const timelineDone = firstClick + LEAD_IN + 4 * BEAT;
    advance(timelineDone + 60 - Date.now());
    expect(run()).toHaveAttribute('data-phase', 'running');
    expect(document.querySelector('.piano-exercise-run__result')).toBeNull();
    advance(firstClick + LEAD_IN + 3 * BEAT + BEAT + 120 - Date.now());
    strike(PASSAGE[3]);
    finish();
    expect(screen.getByText('You started one beat late — start on the click after the count.')).toBeInTheDocument();
    expect(run()).toHaveAttribute('data-entry-shift', '1');
    expect(events('piano.exercise-timing-summary').at(-1)).toMatchObject({ entryShiftBeats: 1 });
    expect(events('piano.exercise-onset-log').at(-1)).toMatchObject({ entryShiftBeats: 1, reason: 'entry-late', matched: 4, possible: 4 });
    advance(1000);
    expect(current.onFailed).toHaveBeenCalledWith(expect.objectContaining({ entryShift: { beats: 1, matched: 4, possible: 4 } }));
  });

  it('names a take one beat early (−1), using the onset played on the last count-in click', async () => {
    await mount();
    const firstClick = armByTap();
    playAt(firstClick, -BEAT - 60);
    finish();
    expect(screen.getByText('You started one beat early — wait for the click after the count.')).toBeInTheDocument();
    const log = events('piano.exercise-onset-log').at(-1);
    expect(log).toMatchObject({ entryShiftBeats: -1, reason: 'entry-early' });
    expect(log.onsets.map(([, , phase]) => phase)).toEqual(['armed', 'countdown', 'countdown', 'running', 'running']);
  });

  it('names nothing for random wrong notes, or the right notes played sloppily', async () => {
    await mount({ maxCueRestarts: 0 });
    let firstClick = armByTap();
    playAt(firstClick, 700, [61, 70, 58, 73]);
    finish();
    expect(run()).not.toHaveAttribute('data-entry-shift');
    expect(screen.queryByText(/You started/)).toBeNull();
    expect(events('piano.exercise-onset-log').at(-1)).toMatchObject({ entryShiftBeats: 0, reason: null });

    view.unmount();
    vi.useRealTimers();
    for (const logger of Object.values(h.log)) logger.mockClear();
    await mount({ maxCueRestarts: 0 });
    firstClick = armByTap();
    [520, -560, 610, -480].forEach((jitter, index) => {
      advance(firstClick + LEAD_IN + index * BEAT + jitter - Date.now());
      strike(PASSAGE[index]);
    });
    finish();
    expect(screen.queryByText(/You started/)).toBeNull();
    expect(events('piano.exercise-onset-log').at(-1)).toMatchObject({ entryShiftBeats: 0 });
  });
});

describe('a cued Learn passage counts a pickup in on its own beat', () => {
  it('ends the count on the beat before a pickup that is one click long', async () => {
    // The first shown bar is a half-note pickup (one click at this pulse) before a 4/4 bar:
    // one click before it is too few, so a bar of two clicks comes first — three in all.
    h.measureMap = [{ index: 0, onsetQuarter: 0, durationQuarters: 2 }, { index: 1, onsetQuarter: 2, durationQuarters: 4 }];
    await mount();
    const firstClick = armByTap();
    expect(events('piano.exercise-countdown-started').at(-1)).toMatchObject({ entry: 'aligned' });
    const seen = [];
    for (const offset of [100, BEAT + 100, 2 * BEAT + 100]) {
      advance(firstClick + offset - Date.now());
      seen.push([band().dataset.count, band().querySelector('.piano-learn-countin__cue').textContent]);
    }
    expect(seen).toEqual([['1', 'Play on the ♩'], ['2', 'Play on the ♩'], ['3', 'next click: play']]);
    // A bar of two (the ready bar), then the pickup's bar: one count, and the note in its beat.
    expect([...band().querySelectorAll('.piano-learn-countin__bar')].map((bar) => bar.textContent)).toEqual(['12', '1♩']);
    advance(firstClick + 3 * BEAT + 60 - Date.now());
    expect(band()).toBeNull();
  });

  it('the press is beat one of the ready bar; the pickup is due three clicks after it', async () => {
    h.measureMap = [{ index: 0, onsetQuarter: 0, durationQuarters: 2 }, { index: 1, onsetQuarter: 2, durationQuarters: 4 }];
    await mount();
    const pressedAt = armByTap();
    expect(events('piano.exercise-countdown-started').at(-1)).toMatchObject({ entry: 'aligned', readyBar: true, bars: 2, slots: 4, pulseCount: 3 });
    PASSAGE.forEach((midi, index) => { advance(pressedAt + 3 * BEAT + index * BEAT + 20 - Date.now()); strike(midi); });
    finish();
    advance(1000);
    expect(current.onPassed).toHaveBeenCalledTimes(1);
  });
});


describe('the bar-shaped count is the Learn passage\'s alone', () => {
  it('a cued score outside Learn keeps the old count before a pickup (no bars, no slots)', async () => {
    h.measureMap = [{ index: 0, onsetQuarter: 0, durationQuarters: 2 }, { index: 1, onsetQuarter: 2, durationQuarters: 4 }];
    await mount({ surface: 'default' });
    hold([55]);
    expect(events('piano.exercise-countdown-started').at(-1)).toMatchObject({ entry: 'aligned', pulseCount: 3, bars: null, readyBar: null, slots: null });
  });

  it('a Learn passage gets the bar-shaped count', async () => {
    h.measureMap = [{ index: 0, onsetQuarter: 0, durationQuarters: 2 }, { index: 1, onsetQuarter: 2, durationQuarters: 4 }];
    await mount();
    armByTap();
    expect(events('piano.exercise-countdown-started').at(-1)).toMatchObject({ entry: 'aligned', bars: 2, readyBar: true, slots: 4 });
  });
});

describe('the count belongs to the passage, not the hand', () => {
  it('a hand that enters after the passage hears the passage count, rests where the passage starts, and is graded where it enters', async () => {
    // The score's first note is on the downbeat (the XML); this hand's first note is a click later.
    h.onsetShift = 2;
    h.measureMap = [0, 1, 2].map((index) => ({ index, onsetQuarter: index * 4, durationQuarters: 4 }));
    await mount();
    const pressedAt = armByTap();
    // The passage's own count (four clicks, two bars of two at this pulse), a rest box on the click the
    // passage starts, and this hand's first note on the click after it.
    expect(events('piano.exercise-countdown-started').at(-1)).toMatchObject({ entry: 'downbeat', pulseCount: 5, leadInMs: 5 * BEAT });
    expect(band().querySelector('.piano-learn-countin__pip.is-rest')).not.toBeNull();
    PASSAGE.forEach((midi, index) => { advance(pressedAt + 5 * BEAT + index * BEAT + 20 - Date.now()); strike(midi); });
    finish();
    advance(1000);
    expect(current.onPassed).toHaveBeenCalledTimes(1);
  });

  it('the click accents the 1 of every bar of the count', async () => {
    h.measureMap = [{ index: 0, onsetQuarter: 0, durationQuarters: 2 }, { index: 1, onsetQuarter: 2, durationQuarters: 4 }];
    await mount();
    armByTap();
    expect(h.click).toMatchObject({ beatsPerBar: 2 });
  });
});


describe('a missed cue goes back to the count', () => {
  it('throws away a take whose first note never came in on the cue and counts in again', async () => {
    await mount();
    const firstClick = armByTap();
    // The first target passes with nothing played: window 400 ms + grace.
    advance(firstClick + LEAD_IN + 700 - Date.now());
    expect(events('piano.exercise-cue-missed')).toEqual([expect.objectContaining({ attempt: 1, windowMs: 400, offsetMs: null })]);
    expect(run()).toHaveAttribute('data-phase', 'ready');
    expect(screen.getAllByText(/missed the cue/i).length).toBeGreaterThan(0);
    expect(document.querySelector('.piano-learn-countin__cue').textContent).toBe('You missed the cue — come in on the ♩');
    expect(document.querySelector('.piano-exercise-run__result')).toBeNull();
    expect(current.onFailed).not.toHaveBeenCalled();
    advance(1000);
    expect(events('piano.exercise-countdown-started').at(-1)).toMatchObject({ reason: 'missed-cue' });
    expect(run()).toHaveAttribute('data-phase', 'countdown');
  });

  it('tells the host the run is holding for a missed-cue restart, then counting again', async () => {
    const onPhase = vi.fn();
    await mount({ onPhase });
    const firstClick = armByTap();
    advance(firstClick + LEAD_IN + 700 - Date.now());
    expect(onPhase).toHaveBeenLastCalledWith('cue-restart');
    // The run itself still reads ready (its own missed-cue notice).
    expect(run()).toHaveAttribute('data-phase', 'ready');
    advance(1000);
    expect(onPhase).toHaveBeenLastCalledWith('countdown');
  });

  it('treats a whole-beat-late first note as a missed cue before it is played', async () => {
    await mount();
    const firstClick = armByTap();
    advance(firstClick + LEAD_IN + BEAT - 200 - Date.now());
    expect(events('piano.exercise-cue-missed')).toHaveLength(1);
  });

  it('leaves a take that came in on the cue alone and resets the count of restarts', async () => {
    await mount();
    const firstClick = armByTap();
    playAt(firstClick, 20);
    finish();
    expect(events('piano.exercise-cue-missed')).toHaveLength(0);
    advance(1000);
    expect(current.onPassed).toHaveBeenCalledTimes(1);
  });

  it(`stops looping after ${MAX_CUE_RESTARTS} restarts in a row and plays the take on`, async () => {
    await mount();
    let firstClick = armByTap();
    for (let n = 1; n <= MAX_CUE_RESTARTS; n += 1) {
      advance(firstClick + LEAD_IN + 700 - Date.now());
      expect(events('piano.exercise-cue-missed')).toHaveLength(n);
      advance(1000);
      firstClick = Date.now() - 1000 + 1000 + GAP; // the auto count's first click
      firstClick = events('piano.exercise-countdown-started').at(-1) ? Date.now() + GAP - 0 : firstClick;
    }
    advance(LEAD_IN + 700 + 2 * GAP);
    expect(events('piano.exercise-cue-missed')).toHaveLength(MAX_CUE_RESTARTS);
    expect(events('piano.exercise-cue-restart-capped')).toHaveLength(1);
  });
});

describe('"Settle into a beat" shows its beat loop', () => {
  const pulseRequirement = { mode: 'metronome', rubric: { id: 'learn-passage-v1', version: '1', criteria: { completeness: 1, cleanliness: 0.8 } } };
  async function mountPulse() {
    current = props({ practiceMode: 'metronome', practiceRequirement: pulseRequirement });
    view = render(<ExerciseRun {...current} />);
    await screen.findByText(/Play the first note to begin/);
    vi.useFakeTimers({ now: Date.now() });
    // The loop's interval was started on real timers: a pause and resume gives it a fake one.
    act(() => { current = { ...current, paused: true }; rerender(); });
    act(() => { current = { ...current, paused: false }; rerender(); });
  }
  const loop = () => document.querySelector('.piano-learn-countin[data-loop]');

  it('runs the beat marker before anything is played, and keeps nothing waiting', async () => {
    await mountPulse();
    advance(400); // the first click is booked a moment after the run is ready
    expect(loop()).not.toBeNull();
    expect(loop().querySelectorAll('.piano-learn-countin__pip')).toHaveLength(4);
    expect(loop().querySelector('.piano-learn-countin__pip.is-accent').textContent).toBe('1');
    expect(loop().querySelector('.piano-learn-countin__cue').textContent).toBe('Play when you feel the beat');
    const lit = () => loop().querySelector('.piano-learn-countin__pip.is-lit')?.textContent;
    const seen = new Set();
    for (let step = 0; step < 24; step += 1) { advance(250); seen.add(lit()); }
    expect([...seen].filter(Boolean).sort()).toEqual(['1', '2', '3', '4']);
    expect(run()).toHaveAttribute('data-phase', 'ready');
    expect(document.querySelector('.piano-exercise-run__result')).toBeNull();
  });

  it('is not on a timed (cued) take, which has its count-in', async () => {
    await mount();
    expect(loop()).toBeNull();
  });
});

describe('the rhythm rung asks for no pitch', () => {
  it('passes a take played on the wrong keys at the right times, and fails one off the beat', async () => {
    await mount({ rhythmOnly: true });
    const firstClick = armByTap();
    playAt(firstClick, 20, [30, 90, 31, 100]); // none of them the passage's notes
    finish();
    advance(1000);
    expect(current.onPassed).toHaveBeenCalledTimes(1);
    expect(current.onFailed).not.toHaveBeenCalled();
  });
  it('reads two keys at once as one tap, as both hands on a beat are', async () => {
    await mount({ rhythmOnly: true });
    const firstClick = armByTap();
    PASSAGE.forEach((_, index) => {
      advance(firstClick + LEAD_IN + index * BEAT + 20 - Date.now());
      hold([40, 72]); advance(80); hold([]);
    });
    finish();
    advance(1000);
    expect(current.onPassed).toHaveBeenCalledTimes(1);
  });
});
