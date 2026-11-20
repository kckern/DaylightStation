import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExerciseRun, { ARM_RELEASE_MS } from './ExerciseRun.jsx';
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
  usePianoMidi: () => ({ connected: true }),
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
vi.mock('../SheetMusic/useMetronomeClick.js', () => ({ useMetronomeClick: () => {} }));
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
          onsetQuarter: step.onsetQuarter - firstOnset,
          measure: step.measure - firstMeasure,
        }));
        onLayout?.({
          width: 800, height: 300, flow: 'wrapped', scale: 1, transpose: 0,
          tempoEntries: [], measures: shownNumbers.map((_, index) => index), events: [], notes: [], steps: localSteps,
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
const GAP = 600; // min(one click, 600 ms)
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
const band = () => document.querySelector('.piano-learn-countin');
const events = (name) => h.log.info.mock.calls.filter(([event]) => event === name).map(([, data]) => data);

async function mount(over = {}) {
  current = props(over);
  view = render(<ExerciseRun {...current} />);
  await screen.findByText(/Press any key to start/);
  // The run is engraved and ready on real timers; the clock is faked from here.
  vi.useFakeTimers({ now: Date.now() });
}

/** Arm with a quick tap and return when the first click will sound. */
function armByTap() {
  strike(55);
  const started = events('piano.exercise-countdown-started').at(-1);
  expect(started).toMatchObject({ reason: 'armed-released', prerollMs: GAP });
  return Date.now() + GAP; // the release instant + the gap
}

beforeEach(() => {
  document.body.innerHTML = '';
  h.activeNotes = new Map();
  h.steps = fourBarSteps();
  h.engraveFails = false;
  h.text.mockReset();
  h.text.mockResolvedValue(fourBars);
  h.record.mockReset();
  h.record.mockResolvedValue({ ok: true, status: 201, data: { attempt_id: 'stored' }, durationMs: 4 });
  for (const logger of Object.values(h.log)) logger.mockClear();
});
afterEach(() => { view?.unmount(); view = null; vi.useRealTimers(); });

describe('a cued Learn passage starts clear of the arming key (A1)', () => {
  it('arms on a held key, shows it heard it, ignores more keys, and counts in after the release plus the gap', async () => {
    await mount();
    hold([55]);
    expect(run()).toHaveAttribute('data-start-armed', 'true');
    expect(run()).toHaveAttribute('data-phase', 'ready');
    expect(band()).toHaveAttribute('data-armed', 'true');
    expect(screen.getByText('Listen for the clicks.')).toBeInTheDocument();
    advance(400);
    // A second key while armed is ignored and does not re-arm.
    hold([55, 60]);
    expect(events('piano.exercise-input-ignored').at(-1)).toMatchObject({ reason: 'armed', ignored: [60] });
    expect(events('piano.exercise-armed')).toHaveLength(1);
    advance(300);
    expect(run()).toHaveAttribute('data-phase', 'ready');
    // Every key held AT ARMING is up (60 came later and does not count).
    hold([60]);
    expect(run()).not.toHaveAttribute('data-start-armed');
    expect(events('piano.exercise-countdown-started')).toEqual([expect.objectContaining({ reason: 'armed-released', prerollMs: GAP, waitedMs: 700 })]);
    expect(run()).toHaveAttribute('data-phase', 'countdown');
    // The gap before the first click: still the armed form, no numeral yet.
    advance(GAP - 50);
    expect(band()).toHaveAttribute('data-armed', 'true');
    advance(100);
    expect(band()).toHaveAttribute('data-count', '1');
  });

  it('starts one second after arming when the arming key is never released', async () => {
    await mount();
    hold([55]);
    advance(ARM_RELEASE_MS - 10);
    expect(run()).toHaveAttribute('data-phase', 'ready');
    expect(events('piano.exercise-countdown-started')).toHaveLength(0);
    advance(20);
    expect(events('piano.exercise-countdown-started')).toEqual([expect.objectContaining({ reason: 'armed-timeout', prerollMs: GAP })]);
    expect(run()).toHaveAttribute('data-phase', 'countdown');
  });

  it('keeps the old immediate start, countdown and PLAY for a cued score outside Learn', async () => {
    await mount({ surface: 'default' });
    hold([55]);
    expect(run()).not.toHaveAttribute('data-start-armed');
    expect(run()).not.toHaveAttribute('data-count-style');
    expect(run()).toHaveAttribute('data-phase', 'countdown');
    expect(events('piano.exercise-countdown-started')).toEqual([expect.objectContaining({ reason: 'arming-key' })]);
    expect(band()).toBeNull();
    advance(400);
    expect(document.querySelector('.piano-score-countin__beat')).toHaveTextContent('4');
  });
});

describe('a cued Learn passage counts up with the clicks (A2)', () => {
  it('shows 1 2 3 4, "next click: play" on the last click, and nothing on the first beat', async () => {
    await mount();
    expect(run()).toHaveAttribute('data-count-style', 'up');
    const firstClick = armByTap();
    const seen = [];
    for (const offset of [10, BEAT + 10, 2 * BEAT + 10, 3 * BEAT + 10]) {
      advance(firstClick + offset - Date.now());
      seen.push([band().dataset.count, band().querySelector('.piano-learn-countin__cue').textContent]);
    }
    expect(seen).toEqual([['1', ''], ['2', ''], ['3', ''], ['4', 'next click: play']]);
    advance(firstClick + LEAD_IN + 60 - Date.now());
    expect(band()).toBeNull();
    expect(document.querySelector('.piano-score-countin')).toBeNull();
    expect(run().textContent).not.toMatch(/PLAY/);
  });
});

describe('a cued Learn passage names a whole-beat shifted entry (A3)', () => {
  /** Play the passage at `offset` from each target (first target = first click + lead-in). */
  function playAt(firstClick, offset, pitches = PASSAGE) {
    pitches.forEach((midi, index) => {
      advance(firstClick + LEAD_IN + index * BEAT + offset - Date.now());
      strike(midi);
    });
  }
  const finish = () => advance(4 * BEAT);

  it('names a steady take one beat late (+1), with its last note retained', async () => {
    await mount();
    const firstClick = armByTap();
    playAt(firstClick, BEAT + 120);
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
    await mount();
    let firstClick = armByTap();
    playAt(firstClick, 700, [61, 70, 58, 73]);
    finish();
    expect(run()).not.toHaveAttribute('data-entry-shift');
    expect(screen.queryByText(/You started/)).toBeNull();
    expect(events('piano.exercise-onset-log').at(-1)).toMatchObject({ entryShiftBeats: 0, reason: null });

    view.unmount();
    vi.useRealTimers();
    for (const logger of Object.values(h.log)) logger.mockClear();
    await mount();
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
