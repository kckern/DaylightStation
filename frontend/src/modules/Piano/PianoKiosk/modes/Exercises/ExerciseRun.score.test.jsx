import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExerciseRun from './ExerciseRun.jsx';
import { requirementForLevel } from '../Games/gateAsk.js';
import fourBars from './__fixtures__/fourBars.musicxml?raw';

/**
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

vi.mock('../../../../../lib/logging/Logger.js', () => ({ default: () => ({ child: () => h.log }) }));
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ connected: true }),
  usePianoMidiNotes: () => ({ activeNotes: h.activeNotes }),
}));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: 'learner4' }) }));
vi.mock('../../../components/PianoKeyboard.jsx', () => ({
  PianoKeyboard: ({ startNote, endNote }) => <div data-testid="keyboard" data-range={`${startNote}-${endNote}`} />,
}));
// NO `pianoLearningApi` DOUBLE: this surface no longer reaches the bank for
// anything. `DaylightAPIText` is still doubled, and that one has teeth — the
// media tree is where a score WOULD be fetched from, and `h.text` never being
// called is the assertion that this run fetches nothing (`AskSession` did).
vi.mock('../SheetMusic/useMetronomeClick.js', () => ({ useMetronomeClick: () => {} }));
vi.mock('../../../../../lib/api.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  DaylightAPIText: h.text,
}));
vi.mock('../../../../MusicNotation/renderers/MusicXmlRenderer.jsx', async () => {
  const { useEffect } = await import('react');
  return {
    MusicXmlRenderer: ({ musicXml, onLayout, onReady, onFailed, children }) => {
      useEffect(() => {
        if (h.engraveFails) { onFailed?.({ error: 'Could not read this score.' }); return; }
        onLayout?.({
          width: 800, height: 300, flow: 'wrapped', scale: 1, transpose: 0,
          tempoEntries: [], measures: [0, 1, 2, 3], events: [], notes: [], steps: h.steps,
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

/** The document a gate level names, and the bars a child reads: E4 F4 G4 A4. */
const SOURCE = 'files:docs/sheet-music/four-bars.musicxml';
const requirement = requirementForLevel({ id: 'score-level', tier: 2, grading: null });

/**
 * What `AskSession` settles on for a `{kind:'score'}` spec and hands down: the
 * document itself, under the id that IS its source path, with the bars the
 * level asked for. There is no other way in — `ExerciseRun`'s `material`
 * compatibility path, which fetched this for itself, was deleted with the last
 * host that used it (ask-platform SP1, task 6).
 */
const settledScore = (over = {}) => Object.freeze({ id: SOURCE, musicXml: fourBars, measures: [2, 3], ...over });

const props = (over = {}) => ({
  intent: 'challenge',
  instance: null,
  score: settledScore(),
  requirement,
  ask: 'Play this passage as written.',
  tier: 2,
  onExit: vi.fn(),
  onPassed: vi.fn(),
  ...over,
});

const press = (view, current, midi) => {
  act(() => { h.activeNotes = new Map([[midi, { velocity: 1 }]]); view.rerender(<ExerciseRun {...current} />); });
  act(() => { h.activeNotes = new Map(); view.rerender(<ExerciseRun {...current} />); });
};

beforeEach(() => {
  document.body.innerHTML = '';
  h.activeNotes = new Map();
  h.steps = fourBarSteps();
  h.engraveFails = false;
  h.text.mockReset();
  h.text.mockResolvedValue(fourBars);
  h.record.mockReset();
  h.record.mockResolvedValue({ ok: true, status: 201, data: { attempt_id: 'stored' }, durationMs: 4 });
  h.createAttempt.mockClear();
  h.prepareExercise.mockClear();
  for (const logger of Object.values(h.log)) logger.mockClear();
});

describe('ExerciseRun — score material, handed down as props', () => {
  it('builds the attempt from the compiled score expectation, never from the exercise bank', async () => {
    const current = props();
    render(<ExerciseRun {...current} />);

    await screen.findByText('Play the first note to begin.');
    // Nothing self-resolved: the host already did, and a second load would land
    // after the first and rebuild the attempt under the child's hands.
    expect(h.text).not.toHaveBeenCalled();
    // `prepareExerciseAssessment` is bank-only: it reads `instance.events`, and
    // a score has none. Calling it here would throw before a note was played.
    expect(h.prepareExercise).not.toHaveBeenCalled();
    const config = h.createAttempt.mock.calls.at(-1)[0];
    expect(config.expectation.source).toMatchObject({ kind: 'score', id: SOURCE });
    expect(config.expectation.events.flatMap((e) => e.notes.map((n) => n.midi))).toEqual([64, 65, 67, 69]);
    expect(config.matcher).toBe('cursor');
    expect(config.mode).toBe('free');
    expect(config.requirement).toBe(requirement);
  });

  it('grades a cued passage against the score’s own tempo, not the surface’s', async () => {
    // `createAssessmentAttempt` rejects a timed attempt whose tempo map does not
    // start at onset zero, so a cued score is only buildable at all because the
    // passage read `<sound tempo="80"/>` out of the document.
    render(<ExerciseRun {...props({ requirement: requirementForLevel({ id: 'cued', tier: 3, grading: null }) })} />);

    await waitFor(() => expect(h.createAttempt).toHaveBeenCalled());
    const config = h.createAttempt.mock.calls.at(-1)[0];
    expect(config.matcher).toBe('timed');
    expect(config.mode).toBe('cued');
    expect(config.expectation.tempoMap).toEqual([{ onsetQuarter: 0, bpm: 80 }]);
    expect(h.prepareExercise).not.toHaveBeenCalled();
  });

  it('mounts the engraved passage as the stage', async () => {
    render(<ExerciseRun {...props()} />);
    await screen.findByText('Play the first note to begin.');
    expect(screen.getByTestId('engraver')).toBeInTheDocument();
    expect(document.querySelector('.piano-exercise-run')).toHaveAttribute('data-stage', 'score');
  });

  it('completes a free run when the passage’s own notes are played, and records it as a score', async () => {
    const current = props();
    const view = render(<ExerciseRun {...current} />);
    await screen.findByText('Play the first note to begin.');

    for (const midi of [64, 65, 67, 69]) press(view, current, midi);

    expect(await screen.findByText('Passed')).toBeInTheDocument();
    await waitFor(() => expect(h.record).toHaveBeenCalledTimes(1));
    const [, evidence] = h.record.mock.calls[0];
    expect(evidence).toMatchObject({
      status: 'completed',
      purpose: 'challenge',
      kind: 'score',
      context: { surface: 'exercises', matcher: 'cursor' },
      diagnostics: { expected_notes: 4, matched_notes: 4 },
    });
    expect(evidence.verdict.passed).toBe(true);
  });

  it('walks the cursor across the engraved noteheads as the passage is played', async () => {
    const current = props();
    const view = render(<ExerciseRun {...current} />);
    await screen.findByText('Play the first note to begin.');

    const lit = () => [...document.querySelectorAll('.mock-notehead.piano-note-lit')].map((el) => Number(el.dataset.midi));
    await waitFor(() => expect(lit()).toEqual([64]));

    press(view, current, 64);
    await waitFor(() => expect(lit()).toEqual([65]));
  });

  /**
   * A HOST RE-RENDER, with the same document. A run that cleared its
   * expectation here would rebuild the attempt from nothing and send the child
   * back to the first note of the passage.
   *
   * Scoped exactly to what it proves: the SAME document object, re-rendered.
   * The hazard an earlier inspection worried about — a host handing down a
   * FRESH document object per render, wiping `scoreExpectation` on the very
   * commit the engraver published it — was RUN as a mutation (task 5, teeth)
   * and does not bite: the clear schedules a re-render, but `installRuntime`
   * runs later in the same commit with the pre-clear value and installs a
   * runtime, and the next commit's `buildAttempt` returns null so
   * `installRuntime` returns early WITHOUT disposing. The already-installed
   * runtime survives, and `ScorePassage` never republishes (`publishedRef`
   * guards it) because it never needs to. Do not reintroduce that claim; it
   * reads plausible and is false.
   */
  it('keeps the engraving across a host re-render, so the cursor does not reset', async () => {
    const current = props();
    const view = render(<ExerciseRun {...current} />);
    await screen.findByText('Play the first note to begin.');
    const lit = () => [...document.querySelectorAll('.mock-notehead.piano-note-lit')].map((el) => Number(el.dataset.midi));

    press(view, current, 64);
    await waitFor(() => expect(lit()).toEqual([65]));

    // The host re-renders (its own state moved) with the SAME document.
    act(() => { view.rerender(<ExerciseRun {...current} />); });

    expect(lit()).toEqual([65]);
    expect(screen.queryByText('Getting the music ready…')).toBeNull();
  });

  /**
   * A SCORE THE MEDIA TREE COULD NOT SERVE is no longer this surface's to
   * report: the fetch lives in `AskSession`, which declines with the reason and
   * never mounts a run on nothing. The claim is unchanged and pinned there —
   * `AskSession.test.jsx` asserts `onUnavailable('instance-not-found', {kind:
   * 'score', reason: 'score-unavailable'})` alongside the same
   * `piano.exercise-material-unresolved` warn. What stays here is the other
   * half, which is this surface's alone: a document that ARRIVES intact and
   * still yields no ask.
   *
   * That is the shape that used to hang: `instance` is null but `score` holds
   * the document, so nothing read as "not found", the run never became
   * unavailable, and the child sat on "Getting the music ready…" until they
   * pressed Leave — forfeiting the game they had earned, logged as an
   * abandonment rather than as the outage it was.
   *
   * Every row must reach a TERMINAL state the host can fail open on.
   *
   * The first row is also the pin on the run's subject reset: the engraver
   * reports its failure from a CHILD effect during the mounting commit, so a
   * reset that ran from an effect in `ExerciseRun` would erase it. Move that
   * reset back into a `useEffect` and this row goes red while the other three
   * (which fail later, from the passage's own compile) stay green.
   */
  describe.each([
    ['the engraver could not read the document', () => { h.engraveFails = true; }, {}],
    ['the engraving carried no notes', () => { h.steps = []; }, {}],
    ['the range names bars the document does not have', () => {}, { measures: [9, 12] }],
    ['the passage is nothing but rests', () => { h.steps = fourBarSteps().filter((s) => s.measure < 2); }, { measures: [3, 4] }],
  ])('when %s', (_label, arrange, scoreOver) => {
    it('ends the run as unrunnable instead of waiting forever', async () => {
      arrange();
      const onUnavailable = vi.fn();
      const current = props({ onUnavailable, score: settledScore(scoreOver) });
      render(<ExerciseRun {...current} />);

      // `unrunnable`, not `instance-not-found`: the document arrived, it simply
      // cannot become an ask. Either way the gate reads it as infrastructure
      // and grants the match.
      await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith('unrunnable'));
      expect(screen.queryByText('Getting the music ready…')).toBeNull();
      expect(h.log.warn).toHaveBeenCalledWith(
        'piano.exercise-score-unrunnable',
        expect.objectContaining({ id: SOURCE }),
      );
    });
  });
});
