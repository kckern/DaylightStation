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
vi.mock('./pianoLearningApi.js', () => ({
  pianoLearningApi: { instance: vi.fn(async () => ({ ok: false, data: null })), program: vi.fn(async () => ({ ok: false, data: null })) },
}));
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

/** Bars 2-3 as a child reads them: E4 F4 G4 A4. */
const material = Object.freeze({
  kind: 'score', source: 'files:docs/sheet-music/four-bars.musicxml', measures: [2, 3],
});
const requirement = requirementForLevel({ id: 'score-level', tier: 2, grading: null });

const props = (over = {}) => ({
  intent: 'challenge',
  material,
  requirementOverride: requirement,
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

describe('ExerciseRun — score material', () => {
  it('builds the attempt from the compiled score expectation, never from the exercise bank', async () => {
    const current = props();
    render(<ExerciseRun {...current} />);

    await screen.findByText('Play the first note to begin.');
    // `prepareExerciseAssessment` is bank-only: it reads `instance.events`, and
    // a score has none. Calling it here would throw before a note was played.
    expect(h.prepareExercise).not.toHaveBeenCalled();
    const config = h.createAttempt.mock.calls.at(-1)[0];
    expect(config.expectation.source).toMatchObject({ kind: 'score', id: material.source });
    expect(config.expectation.events.flatMap((e) => e.notes.map((n) => n.midi))).toEqual([64, 65, 67, 69]);
    expect(config.matcher).toBe('cursor');
    expect(config.mode).toBe('free');
    expect(config.requirement).toBe(requirement);
  });

  it('grades a cued passage against the score’s own tempo, not the surface’s', async () => {
    // `createAssessmentAttempt` rejects a timed attempt whose tempo map does not
    // start at onset zero, so a cued score is only buildable at all because the
    // passage read `<sound tempo="80"/>` out of the document.
    render(<ExerciseRun {...props({ requirementOverride: requirementForLevel({ id: 'cued', tier: 3, grading: null }) })} />);

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

  it('fails open on a score the media tree could not serve', async () => {
    h.text.mockRejectedValue(new Error('HTTP 502: Bad Gateway'));
    const onUnavailable = vi.fn();
    render(<ExerciseRun {...props({ onUnavailable })} />);

    await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith('instance-not-found'));
    expect(h.log.warn).toHaveBeenCalledWith(
      'piano.exercise-material-unresolved',
      expect.objectContaining({ kind: 'score', error: 'score-unavailable' }),
    );
  });

  /**
   * A score that FETCHES fine and then yields no ask. This is the shape that
   * used to hang: `instance` is null but `score` holds the document, so nothing
   * read as "not found", the run never became unavailable, and the child sat on
   * "Getting the music ready…" until they pressed Leave — forfeiting the game
   * they had earned, logged as an abandonment rather than as the outage it was.
   *
   * Every row must reach a TERMINAL state the host can fail open on.
   */
  describe.each([
    ['the engraver could not read the document', () => { h.engraveFails = true; }, {}],
    ['the engraving carried no notes', () => { h.steps = []; }, {}],
    ['the range names bars the document does not have', () => {}, { measures: [9, 12] }],
    ['the passage is nothing but rests', () => { h.steps = fourBarSteps().filter((s) => s.measure < 2); }, { measures: [3, 4] }],
  ])('when %s', (_label, arrange, materialOver) => {
    it('ends the run as unrunnable instead of waiting forever', async () => {
      arrange();
      const onUnavailable = vi.fn();
      const current = props({
        onUnavailable,
        material: { ...material, ...materialOver },
      });
      render(<ExerciseRun {...current} />);

      // `unrunnable`, not `instance-not-found`: the document arrived, it simply
      // cannot become an ask. Either way the gate reads it as infrastructure
      // and grants the match.
      await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith('unrunnable'));
      expect(screen.queryByText('Getting the music ready…')).toBeNull();
      expect(h.log.warn).toHaveBeenCalledWith(
        'piano.exercise-score-unrunnable',
        expect.objectContaining({ id: material.source }),
      );
    });
  });
});

/**
 * The same passage, arriving the way every host hands it down now: as a
 * SETTLED `score` document beside an explicit `instance: null`, resolved above
 * by `AskSession` rather than fetched here.
 *
 * The block above drives the compatibility path (`material`, self-resolved),
 * and until this suite existed that was the only path a REAL `ScorePassage`
 * had ever been driven through — the props path's safety was argued by
 * inspection. That argument was load-bearing and thin: the expectation arrives
 * from the engraver a commit LATE, and the props path clears
 * `scoreExpectation` on a `[instanceProp, scoreProp]` change. A host handing
 * down a fresh document object per render would therefore wipe the engraving
 * on the very commit that published it, and a child would sit on "Getting the
 * music ready…" forever — with every existing assertion green, because none of
 * them takes this door.
 */
describe('ExerciseRun — score material handed down as props', () => {
  /** What `AskSession` settles on for `{kind:'score'}`: id, document, bars. */
  const settledScore = Object.freeze({ id: material.source, musicXml: fourBars, measures: [2, 3] });

  const handedDown = (over = {}) => ({
    intent: 'challenge',
    instance: null,
    score: settledScore,
    requirement,
    ask: 'Play this passage as written.',
    tier: 2,
    onExit: vi.fn(),
    onPassed: vi.fn(),
    ...over,
  });

  it('engraves the document it was given and builds the attempt from it, fetching nothing', async () => {
    render(<ExerciseRun {...handedDown()} />);

    await screen.findByText('Play the first note to begin.');
    // Nothing self-resolved: the host already did, and a second load would land
    // after the first and rebuild the attempt under the child's hands.
    expect(h.text).not.toHaveBeenCalled();
    expect(h.prepareExercise).not.toHaveBeenCalled();
    expect(screen.getByTestId('engraver')).toBeInTheDocument();
    expect(document.querySelector('.piano-exercise-run')).toHaveAttribute('data-stage', 'score');
    const config = h.createAttempt.mock.calls.at(-1)[0];
    expect(config.expectation.source).toMatchObject({ kind: 'score', id: material.source });
    expect(config.expectation.events.flatMap((e) => e.notes.map((n) => n.midi))).toEqual([64, 65, 67, 69]);
    expect(config.requirement).toBe(requirement);
  });

  it('plays through to a pass, graded by the real engine off the real engraving', async () => {
    const current = handedDown();
    const view = render(<ExerciseRun {...current} />);
    await screen.findByText('Play the first note to begin.');

    for (const midi of [64, 65, 67, 69]) press(view, current, midi);

    expect(await screen.findByText('Passed')).toBeInTheDocument();
    await waitFor(() => expect(h.record).toHaveBeenCalledTimes(1));
    expect(h.record.mock.calls[0][1]).toMatchObject({
      status: 'completed', kind: 'score', diagnostics: { expected_notes: 4, matched_notes: 4 },
    });
  });

  it('keeps the engraving across a host re-render, so the cursor does not reset', async () => {
    const current = handedDown();
    const view = render(<ExerciseRun {...current} />);
    await screen.findByText('Play the first note to begin.');
    const lit = () => [...document.querySelectorAll('.mock-notehead.piano-note-lit')].map((el) => Number(el.dataset.midi));

    press(view, current, 64);
    await waitFor(() => expect(lit()).toEqual([65]));

    // The host re-renders (its own state moved) with the SAME document. A run
    // that cleared its expectation here would rebuild the attempt from nothing
    // and send the child back to the first note of the passage.
    act(() => { view.rerender(<ExerciseRun {...current} />); });

    expect(lit()).toEqual([65]);
    expect(screen.queryByText('Getting the music ready…')).toBeNull();
  });
});
