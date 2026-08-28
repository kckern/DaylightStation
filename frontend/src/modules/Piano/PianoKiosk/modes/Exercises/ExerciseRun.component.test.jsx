import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExerciseRun from './ExerciseRun.jsx';
import { initialRung, requirementForRung } from '../Games/gameGateLadder.js';

const h = vi.hoisted(() => ({
  activeNotes: new Map(),
  record: vi.fn(),
  createAttempt: vi.fn(),
  // The two runtime calls the start model is made of. Spied through, never
  // replaced: the real engine still grades every note.
  start: vi.fn(),
  observe: vi.fn(),
  metronome: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  // Per-test instance override; null means "use the standard fixture".
  instanceData: null,
  // Per-test knobs for the run's two terminal-state doors.
  instanceOk: true,
  currentUser: 'learner4',
  instance: {
    id: 'scales/c-major@test',
    title: 'C major fragment',
    form: 'scale',
    ordering: 'strict',
    key: 'C',
    meter: '4/4',
    tempo: { start_bpm: 90 },
    level: { free: 1 },
    events: [
      { id: 'first', value: 'quarter', notes: [{ midi: 60, hand: 'right' }] },
      { id: 'second', value: 'quarter', notes: [{ midi: 62, hand: 'right' }] },
    ],
  },
}));

vi.mock('../../../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => h.log }),
}));
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ connected: true }),
  usePianoMidiNotes: () => ({ activeNotes: h.activeNotes }),
}));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: h.currentUser }) }));
vi.mock('../../../components/PianoKeyboard.jsx', () => ({
  // `wrongNotes` is the real consumer of `lastWrong.midi` — the footer lights the
  // key the child actually played. Surface it so the test can see it.
  PianoKeyboard: ({ wrongNotes }) => (
    <div data-testid="keyboard" data-wrong={[...(wrongNotes ?? [])].join(',')} />
  ),
}));
vi.mock('./ExerciseNotation.jsx', () => ({
  default: ({ eventIndex, wrong }) => (
    <div data-testid="notation" data-wrong={String(wrong)}>{eventIndex}</div>
  ),
}));
vi.mock('./pianoLearningApi.js', () => ({
  pianoLearningApi: {
    instance: vi.fn(async () => (h.instanceOk
      ? { ok: true, data: h.instanceData ?? h.instance }
      : { ok: false, status: 502, data: null })),
    program: vi.fn(async () => ({ ok: false, data: null })),
  },
}));
vi.mock('../SheetMusic/useMetronomeClick.js', () => ({ useMetronomeClick: (...args) => h.metronome(...args) }));
vi.mock('../../../performance/attemptEvidence.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, pianoAttemptClient: { record: h.record } };
});
vi.mock('../../../performance/assessmentSession.js', async (importOriginal) => {
  const actual = await importOriginal();
  h.createAttempt.mockImplementation(actual.createAssessmentAttempt);
  return {
    ...actual,
    createAssessmentAttempt: (...args) => h.createAttempt(...args),
    // A pass-through wrapper, not a double: the surface drives the REAL runtime,
    // and the spies only record how it was driven (start's lead-in, and which
    // notes reached observe).
    createAssessmentRuntime: (...args) => {
      const runtime = actual.createAssessmentRuntime(...args);
      return {
        ...runtime,
        start: (options) => { h.start(options); return runtime.start(options); },
        observe: (event) => { h.observe(event); return runtime.observe(event); },
      };
    },
  };
});

describe('ExerciseRun shared assessment wiring', () => {
  beforeEach(() => {
    h.activeNotes = new Map();
    h.instanceData = null;
    h.instanceOk = true;
    h.currentUser = 'learner4';
    h.record.mockReset();
    h.record.mockResolvedValue({ ok: true, status: 201, data: { attempt_id: 'stored' }, durationMs: 4 });
    h.start.mockClear();
    h.observe.mockClear();
    h.metronome.mockClear();
    // mockClear, not mockReset — the implementation is installed once by the
    // module factory and must survive between tests.
    h.createAttempt.mockClear();
    for (const logger of Object.values(h.log)) logger.mockClear();
  });

  // Press and release, so the next press of the same pitch is seen as a new onset.
  const press = (view, props, midi) => {
    act(() => { h.activeNotes = new Map([[midi, { velocity: 1 }]]); view.rerender(<ExerciseRun {...props} />); });
    act(() => { h.activeNotes = new Map(); view.rerender(<ExerciseRun {...props} />); });
  };

  // Hold a set of pitches down together (no release) — what a chord ask needs.
  const hold = (view, props, midis) => {
    act(() => {
      h.activeNotes = new Map(midis.map((midi) => [midi, { velocity: 1 }]));
      view.rerender(<ExerciseRun {...props} />);
    });
  };

  /**
   * The piano starts the run now, so there is no button to click: a free ask
   * waits for its ready hint and then plays the note the ask actually wants.
   * That note ARMS the attempt and is also its first graded note, which is why
   * every wrong-note sequence below now comes after it rather than before it.
   */
  const armFree = async (view, props, midi = 60) => {
    await screen.findByText('Play the first note to begin.');
    press(view, props, midi);
  };

  it('drives MIDI through the shared cursor runtime and persists completed practice evidence', async () => {
    const props = { instanceId: h.instance.id, intent: 'practice', practiceMode: 'free', onExit: vi.fn(), onPassed: vi.fn() };
    const view = render(<ExerciseRun {...props} />);
    await screen.findByText('Play the first note to begin.');

    act(() => { h.activeNotes = new Map([[60, { velocity: 1 }]]); view.rerender(<ExerciseRun {...props} />); });
    await waitFor(() => expect(screen.getByTestId('notation')).toHaveTextContent('1'));
    act(() => { h.activeNotes = new Map(); view.rerender(<ExerciseRun {...props} />); });
    act(() => { h.activeNotes = new Map([[62, { velocity: 1 }]]); view.rerender(<ExerciseRun {...props} />); });

    expect(await screen.findByText('Passed')).toBeInTheDocument();
    await waitFor(() => expect(h.record).toHaveBeenCalledTimes(1));
    const [userId, evidence] = h.record.mock.calls[0];
    expect(userId).toBe('learner4');
    expect(evidence).toMatchObject({
      status: 'completed',
      purpose: 'practice',
      activity_id: `exercise:${h.instance.id}:free`,
      criteria: { completeness: 1, cleanliness: 1 },
      context: { surface: 'exercises', matcher: 'cursor' },
      diagnostics: { expected_notes: 2, matched_notes: 2, wrong_notes: 0, missed_notes: 0 },
    });
    expect(evidence.criteria).not.toHaveProperty('placement');
    expect(evidence.verdict.passed).toBe(true);
  });

  it('requirement.policy overrides the hardcoded defaults', async () => {
    const props = {
      instanceId: h.instance.id,
      intent: 'challenge',
      requirementOverride: { mode: 'free', policy: { wrongWindow: 5 } },
      onExit: vi.fn(),
      onPassed: vi.fn(),
    };
    render(<ExerciseRun {...props} />);
    await screen.findByText('Play the first note to begin.');

    const config = h.createAttempt.mock.calls.at(-1)[0];
    expect(config.policy).toMatchObject({
      // the requirement wins…
      wrongWindow: 5,
      // …without discarding the surface's own defaults
      matchWindowMs: 220, missWindowMs: 420, timingToleranceMs: 80, timingWindowMs: 320,
    });
  });

  it('a wrong event exposes the played midi', async () => {
    const props = { instanceId: h.instance.id, intent: 'practice', practiceMode: 'free', onExit: vi.fn(), onPassed: vi.fn() };
    const view = render(<ExerciseRun {...props} />);
    // The wrong note has to land INSIDE a running attempt now: a stray note in
    // the ready phase is a child finding their hands, not a wrong answer.
    await armFree(view, props); // 60 arms and hits event one; event two wants 62

    press(view, props, 61); // a semitone below the expected 62 — wrong, but plausible

    await waitFor(() => expect(screen.getByTestId('keyboard')).toHaveAttribute('data-wrong', '61'));
    expect(screen.getByRole('status')).toHaveTextContent('That note was not expected');
    // The notation only ever wanted a flag, and still gets exactly that.
    expect(screen.getByTestId('notation')).toHaveAttribute('data-wrong', 'true');

    press(view, props, 62); // a hit clears it
    await waitFor(() => expect(screen.getByTestId('keyboard')).toHaveAttribute('data-wrong', ''));
  });

  it('a completed floor attempt with N wrong notes still passes', async () => {
    // The Task-8 floor: rubric `{criteria:{completeness:1}}`, cleanliness
    // deliberately absent. A child who has already failed every rung must be
    // able to finish. Wrong notes are recorded, not disqualifying.
    const floor = { timing: 'free', hands: 1, span: 1, difficulty: 'major', direction: 'ascending' };
    const requirementOverride = requirementForRung(floor, { passScore: 0.9 });
    expect(requirementOverride.rubric).toEqual({ criteria: { completeness: 1 } });

    const props = { instanceId: h.instance.id, intent: 'challenge', requirementOverride, onExit: vi.fn(), onPassed: vi.fn() };
    const view = render(<ExerciseRun {...props} />);
    // Same five notes, same evidence — only the order moved: the arming note
    // starts the run, and the three wrongs land against event two.
    await armFree(view, props);
    press(view, props, 61);
    press(view, props, 61);
    press(view, props, 61);
    press(view, props, 62);

    expect(await screen.findByText('Passed')).toBeInTheDocument();
    await waitFor(() => expect(h.record).toHaveBeenCalledTimes(1));
    const [, evidence] = h.record.mock.calls[0];
    expect(evidence.verdict.passed).toBe(true);
    expect(evidence.verdict.failed_criteria).toEqual([]);
    // Nothing is hidden from the record: the wrongs are still in the evidence.
    expect(evidence.diagnostics).toMatchObject({ expected_notes: 2, matched_notes: 2, wrong_notes: 3, missed_notes: 0 });
    expect(evidence.criteria.completeness).toBe(1);
    expect(evidence.criteria.cleanliness).toBeLessThan(1);
  });

  // A non-floor rung: `requirementForRung` emits a passScore and NO rubric, so
  // the engine's `verdict.passed` is unconditionally true. The surface must
  // judge on the score, or every child clears the hardest rung instantly.
  const nonFloorRung = { timing: 'free', hands: 2, span: 1, difficulty: 'major', direction: 'ascending' };

  it('a non-floor rung below its passScore is not a pass, whatever the engine verdict says', async () => {
    const requirementOverride = requirementForRung(nonFloorRung, { passScore: 0.8 });
    expect(requirementOverride).toMatchObject({ mode: 'free', passScore: 0.8 });
    expect(requirementOverride.rubric).toBeUndefined();

    const props = { instanceId: h.instance.id, intent: 'challenge', requirementOverride, onExit: vi.fn(), onPassed: vi.fn() };
    const view = render(<ExerciseRun {...props} />);
    await armFree(view, props);
    press(view, props, 61);
    press(view, props, 61);
    press(view, props, 61);
    press(view, props, 62); // complete, but cleanliness 2/5 -> score 0.7

    expect(await screen.findByText('Keep working')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Practice first' })).toBeInTheDocument();
    expect(props.onPassed).not.toHaveBeenCalled();

    // The engine still says "passed" — which is exactly why the surface cannot
    // read it on a rung that carries no rubric.
    await waitFor(() => expect(h.record).toHaveBeenCalledTimes(1));
    expect(h.record.mock.calls[0][1].verdict.passed).toBe(true);
  });

  it('a non-floor rung at or above its passScore passes, and hands the result to the host', async () => {
    const requirementOverride = requirementForRung(nonFloorRung, { passScore: 0.8 });
    const props = { instanceId: h.instance.id, intent: 'challenge', requirementOverride, onExit: vi.fn(), onPassed: vi.fn() };
    const view = render(<ExerciseRun {...props} />);
    await armFree(view, props);
    press(view, props, 62); // clean run -> score 1

    expect(await screen.findByText('Passed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // The host gets the result rather than a click event, so it can read the
    // score without re-deriving it.
    expect(props.onPassed).toHaveBeenCalledTimes(1);
    expect(props.onPassed.mock.calls[0][0]).toMatchObject({ status: 'completed', score: 1 });
  });

  it('a cued requirement on a tempo-less instance degrades instead of blanking the kiosk', async () => {
    h.instanceData = { ...h.instance, tempo: undefined };
    const requirementOverride = requirementForRung(initialRung(), { passScore: 0.8 });
    expect(requirementOverride.mode).toBe('cued');

    const props = { instanceId: h.instance.id, intent: 'challenge', requirementOverride, onExit: vi.fn(), onPassed: vi.fn() };
    render(<ExerciseRun {...props} />);

    expect(await screen.findByText(/Cannot start this one/)).toBeInTheDocument();
    expect(h.log.warn).toHaveBeenCalledWith('piano.exercise-attempt-unbuildable', expect.objectContaining({
      id: h.instance.id, mode: 'cued', reason: 'Cued assessment requires a usable tempo',
    }));
  });

  // ── The two host callbacks a gate needs, and a practice surface must not
  // notice. Both are optional: omitting them is today's behaviour exactly.

  it('reports a COMPLETED miss through onFailed, with the result, and never on a pass', async () => {
    // A host that moves a difficulty ladder must be able to tell a played-and-
    // missed attempt from a walked-away one. `onExit` cannot do that: it fires
    // for the header Exit too, so counting it would let a player reach the
    // easiest rung without touching a key.
    const requirementOverride = requirementForRung(nonFloorRung, { passScore: 0.8 });
    const props = {
      instanceId: h.instance.id, intent: 'challenge', requirementOverride,
      onExit: vi.fn(), onPassed: vi.fn(), onFailed: vi.fn(),
    };
    const view = render(<ExerciseRun {...props} />);
    await armFree(view, props);
    press(view, props, 61);
    press(view, props, 61);
    press(view, props, 61);
    press(view, props, 62); // complete, cleanliness 2/5 -> score 0.7, under the 0.8 bar

    await waitFor(() => expect(props.onFailed).toHaveBeenCalledTimes(1));
    expect(props.onFailed.mock.calls[0][0]).toMatchObject({ status: 'completed', score: 0.7 });
    expect(props.onPassed).not.toHaveBeenCalled();
    expect(props.onExit).not.toHaveBeenCalled();
  });

  it('does not report a pass as a failure', async () => {
    const requirementOverride = requirementForRung(nonFloorRung, { passScore: 0.8 });
    const props = {
      instanceId: h.instance.id, intent: 'challenge', requirementOverride,
      onExit: vi.fn(), onPassed: vi.fn(), onFailed: vi.fn(),
    };
    const view = render(<ExerciseRun {...props} />);
    await armFree(view, props);
    press(view, props, 62); // clean run -> score 1

    expect(await screen.findByText('Passed')).toBeInTheDocument();
    expect(props.onFailed).not.toHaveBeenCalled();
  });

  it.each([
    ['the instance fetch fails', { instanceOk: false }, 'instance-not-found', /Exercise not found/],
    ['the attempt cannot be built', { instanceData: null, tempoLess: true }, 'unrunnable', /Cannot start this one/],
    ['a guest opens a challenge', { currentUser: 'guest' }, 'no-access', /Choose a player/],
  ])('reports a dead end through onUnavailable when %s', async (_label, setup, reason, copy) => {
    // All three render a PianoEmpty whose only affordance is the header Exit.
    // A host that mounted this run without chrome of its own — the game gate
    // does exactly that — would strand a child there with no callback and no
    // way forward.
    if (setup.instanceOk === false) h.instanceOk = false;
    if (setup.tempoLess) h.instanceData = { ...h.instance, tempo: undefined };
    if (setup.currentUser) h.currentUser = setup.currentUser;

    const props = {
      instanceId: h.instance.id, intent: 'challenge',
      requirementOverride: requirementForRung(initialRung(), { passScore: 0.8 }),
      onExit: vi.fn(), onPassed: vi.fn(), onUnavailable: vi.fn(),
    };
    render(<ExerciseRun {...props} />);

    expect(await screen.findByText(copy)).toBeInTheDocument();
    await waitFor(() => expect(props.onUnavailable).toHaveBeenCalledWith(reason));
    expect(props.onUnavailable).toHaveBeenCalledTimes(1);
  });

  it('a run given neither callback behaves exactly as it always did', async () => {
    // The practice surface passes neither. Nothing may throw, and the existing
    // empty state must still be what a player sees.
    h.instanceOk = false;
    const props = { instanceId: h.instance.id, intent: 'practice', practiceMode: 'free', onExit: vi.fn(), onPassed: vi.fn() };
    render(<ExerciseRun {...props} />);
    expect(await screen.findByText(/Exercise not found/)).toBeInTheDocument();
  });

  it('withholds no-access while the user is still hydrating, and reports it once settled', async () => {
    // `currentUser` starts null and hydrates asynchronously (the roster fetch
    // retries on a 2s/5s/15s/30s backoff — exactly during the backend restarts
    // the dead-end reporting exists for). Reporting on the first commit tells a
    // host "this player is not allowed" about a player who has not arrived yet,
    // and a host that fails open on that hands out a free game every reload.
    h.currentUser = null;
    const props = {
      instanceId: h.instance.id, intent: 'challenge',
      requirementOverride: requirementForRung(initialRung(), { passScore: 0.8 }),
      onExit: vi.fn(), onPassed: vi.fn(), onUnavailable: vi.fn(),
    };
    const view = render(<ExerciseRun {...props} />);
    expect(await screen.findByText(/Choose a player/)).toBeInTheDocument();
    expect(props.onUnavailable).not.toHaveBeenCalled();

    // 'guest' is hydrated-and-not-permitted — a real answer, and reportable.
    act(() => { h.currentUser = 'guest'; view.rerender(<ExerciseRun {...props} />); });
    await waitFor(() => expect(props.onUnavailable).toHaveBeenCalledWith('no-access'));
  });

  it('leaves its own failure panel to the host that took onFailed', async () => {
    // `onFailed` fires from a passive effect, which React schedules AFTER
    // paint. Rendering this panel too would flash "Keep working" with two
    // tappable buttons — Retry and Practice first — for a frame before the host
    // swapped it out. On a tablet that is a mis-tap, not a blink.
    const requirementOverride = requirementForRung(nonFloorRung, { passScore: 0.8 });
    const props = {
      instanceId: h.instance.id, intent: 'challenge', requirementOverride,
      onExit: vi.fn(), onPassed: vi.fn(), onFailed: vi.fn(),
    };
    const view = render(<ExerciseRun {...props} />);
    await armFree(view, props);
    press(view, props, 61);
    press(view, props, 61);
    press(view, props, 61);
    press(view, props, 62); // score 0.7, under the bar

    await waitFor(() => expect(props.onFailed).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Keep working')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Practice first' })).not.toBeInTheDocument();
  });

  it('still shows its own panel when no host took onFailed', async () => {
    // The practice surface and the program flow pass neither callback; their
    // result panel is the only one there is and must be untouched.
    const requirementOverride = requirementForRung(nonFloorRung, { passScore: 0.8 });
    const props = { instanceId: h.instance.id, intent: 'challenge', requirementOverride, onExit: vi.fn(), onPassed: vi.fn() };
    const view = render(<ExerciseRun {...props} />);
    await armFree(view, props);
    press(view, props, 61);
    press(view, props, 61);
    press(view, props, 61);
    press(view, props, 62);

    expect(await screen.findByText('Keep working')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Practice first' })).toBeInTheDocument();
  });

  it('a host that took onFailed still gets the run’s own pass panel', async () => {
    // Only the FAILURE panel is the host's business. `onPassed` is
    // player-driven, so Continue must still be there to press.
    const requirementOverride = requirementForRung(nonFloorRung, { passScore: 0.8 });
    const props = {
      instanceId: h.instance.id, intent: 'challenge', requirementOverride,
      onExit: vi.fn(), onPassed: vi.fn(), onFailed: vi.fn(),
    };
    const view = render(<ExerciseRun {...props} />);
    await armFree(view, props);
    press(view, props, 62); // clean -> score 1

    expect(await screen.findByText('Passed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(props.onPassed).toHaveBeenCalledTimes(1);
  });

  // ── The start model. The piano starts the attempt: nothing to read, nothing
  // to tap, no second gesture between a child and the first note.

  it('a free ask arms on the first expected note, and that note is the first graded note', async () => {
    const props = { instanceId: h.instance.id, intent: 'practice', practiceMode: 'free', onExit: vi.fn(), onPassed: vi.fn() };
    const view = render(<ExerciseRun {...props} />);
    await screen.findByText('Play the first note to begin.');
    expect(h.start).not.toHaveBeenCalled();

    press(view, props, 60);

    expect(h.start).toHaveBeenCalledWith({ leadInMs: 0, clock: 'date-now' });
    // Order is the whole contract: start FIRST, then the same note observed —
    // otherwise the note that armed the run is thrown away ungraded.
    expect(h.start.mock.invocationCallOrder[0]).toBeLessThan(h.observe.mock.invocationCallOrder[0]);
    expect(h.observe.mock.calls[0][0]).toMatchObject({ midi: 60, clock: 'date-now' });
    // And it really was graded: the cursor is on event two.
    await waitFor(() => expect(screen.getByTestId('notation')).toHaveTextContent('1'));
  });

  it('a free ask ignores a note it did not ask for, and stays ready', async () => {
    // A child finding their hands is not a wrong answer. Nothing starts,
    // nothing is graded, and nothing flashes red.
    const props = { instanceId: h.instance.id, intent: 'practice', practiceMode: 'free', onExit: vi.fn(), onPassed: vi.fn() };
    const view = render(<ExerciseRun {...props} />);
    await screen.findByText('Play the first note to begin.');

    press(view, props, 61); // a semitone off the 60 this ask wants

    expect(h.start).not.toHaveBeenCalled();
    expect(h.observe).not.toHaveBeenCalled();
    expect(screen.getByText('Play the first note to begin.')).toBeInTheDocument();
    expect(screen.getByTestId('notation')).toHaveTextContent('0');
    expect(screen.getByTestId('keyboard')).toHaveAttribute('data-wrong', '');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('a cued ask arms on ANY key, counts in one measure, and does not grade the arming key', async () => {
    // 4/4 at 60bpm — one measure is exactly four seconds of count-in.
    h.instanceData = { ...h.instance, tempo: { start_bpm: 60 } };
    const requirementOverride = requirementForRung(initialRung(), { passScore: 0.8 });
    expect(requirementOverride.mode).toBe('cued');

    const props = { instanceId: h.instance.id, intent: 'challenge', requirementOverride, onExit: vi.fn(), onPassed: vi.fn() };
    const view = render(<ExerciseRun {...props} />);
    await screen.findByText("Press any key to start. You'll hear 4 clicks, then play at that speed.");
    // The click is silent until a key arms the run.
    expect(h.metronome.mock.calls.at(-1)[0]).toMatchObject({ enabled: false });

    press(view, props, 63); // any key at all — not a note this ask expects

    expect(h.start).toHaveBeenCalledWith({ leadInMs: 4 * 60000 / 60, clock: 'date-now' });
    // The arming key is a gesture, not a performance: it is never graded.
    expect(h.observe).not.toHaveBeenCalled();
    // The count-in is visible from its first beat…
    expect(screen.getByLabelText('Count in, beat 1')).toBeInTheDocument();
    // …and audible: the metronome covers the lead-in, so the last count-in
    // click and the first played beat are one grid.
    expect(h.metronome.mock.calls.at(-1)[0]).toMatchObject({ enabled: true, bpm: 60 });
  });

  it('counts a cued ask in at the tempo it is graded at, not at a tempo it has not got', async () => {
    // A single-event cued instance with no tempo of its own is given the
    // engine's default (90bpm) to grade against. The count-in has to follow it:
    // counting at one tempo and marking at another moves every target note.
    h.instanceData = {
      ...h.instance,
      tempo: undefined,
      events: [{ id: 'only', value: 'quarter', notes: [{ midi: 60, hand: 'right' }] }],
    };
    const requirementOverride = requirementForRung(initialRung(), { passScore: 0.8 });
    const props = { instanceId: h.instance.id, intent: 'challenge', requirementOverride, onExit: vi.fn(), onPassed: vi.fn() };
    const view = render(<ExerciseRun {...props} />);
    await screen.findByText("Press any key to start. You'll hear 4 clicks, then play at that speed.");

    press(view, props, 72);

    expect(h.start).toHaveBeenCalledWith({ leadInMs: 4 * 60000 / 90, clock: 'date-now' });
    // And the clicks are AUDIBLE at that same tempo. `clickBpm` is NaN here —
    // a cued rung carries no `gates.pace` and this instance has no tempo — and
    // the hook creates no scheduler at all for a non-positive bpm, so a child
    // would have watched a silent count-in and then been graded on placement
    // against a grid they were never given.
    expect(h.metronome.mock.calls.at(-1)[0]).toMatchObject({ enabled: true, bpm: 90 });
  });

  it('gives metronome practice its pulse BEFORE the first note, not after it', async () => {
    // The mode's whole promise is a grid to settle into, and the first note is
    // now what starts the run — a click that waits for `running` arrives after
    // the moment it exists to guide.
    const props = { instanceId: h.instance.id, intent: 'practice', practiceMode: 'metronome', onExit: vi.fn(), onPassed: vi.fn() };
    const view = render(<ExerciseRun {...props} />);
    await screen.findByText('Play the first note to begin.');

    expect(h.metronome.mock.calls.at(-1)[0]).toMatchObject({ enabled: true, bpm: 90 });

    press(view, props, 60); // the run arms and keeps clicking, uninterrupted
    expect(h.metronome.mock.calls.at(-1)[0]).toMatchObject({ enabled: true, bpm: 90 });
  });

  it('a held (ordering:any) ask arms on ANY note of the chord it is asking for', async () => {
    // The material's own contract is "any order", so demanding one particular
    // note to arm would strand a child who reaches the chord from the top.
    h.instanceData = {
      ...h.instance,
      ordering: 'any',
      events: [{ id: 'chord', value: 'quarter', notes: [{ midi: 60, hand: 'right' }, { midi: 64, hand: 'right' }] }],
    };
    const props = { instanceId: h.instance.id, intent: 'practice', practiceMode: 'free', onExit: vi.fn(), onPassed: vi.fn() };
    const view = render(<ExerciseRun {...props} />);
    await screen.findByText('Play the first note to begin.');

    hold(view, props, [67]); // outside the chord — still nothing
    expect(h.start).not.toHaveBeenCalled();
    expect(screen.getByText('Play the first note to begin.')).toBeInTheDocument();

    hold(view, props, []);
    hold(view, props, [64]); // the TOP note of the chord arms it

    expect(h.start).toHaveBeenCalledWith({ leadInMs: 0, clock: 'date-now' });
    expect(h.observe.mock.calls[0][0]).toMatchObject({ clock: 'date-now' });
    expect([...h.observe.mock.calls[0][0].held.keys()]).toEqual([64]);

    hold(view, props, [60, 64]); // the whole chord completes it
    expect(await screen.findByText('Passed')).toBeInTheDocument();
  });

  it('a key already down when a held ask arms stays inert — it is not graded as an extra', async () => {
    // The stray is declared inert in the ready phase, so it must not be
    // promoted to a graded note by the arming observation: handing the WHOLE
    // held map over at that boundary would score the chord as wrong, latch it,
    // and leave the child unable to complete until they lift a finger nothing
    // told them about.
    h.instanceData = {
      ...h.instance,
      ordering: 'any',
      events: [{ id: 'chord', value: 'quarter', notes: [{ midi: 60, hand: 'right' }, { midi: 64, hand: 'right' }] }],
    };
    const props = { instanceId: h.instance.id, intent: 'practice', practiceMode: 'free', onExit: vi.fn(), onPassed: vi.fn() };
    const view = render(<ExerciseRun {...props} />);
    await screen.findByText('Play the first note to begin.');

    hold(view, props, [67]);     // a stray, and it stays down
    hold(view, props, [67, 64]); // the intentional reach, on top of it

    expect(h.start).toHaveBeenCalledWith({ leadInMs: 0, clock: 'date-now' });
    // Only the chord's own member crossed the boundary…
    expect([...h.observe.mock.calls[0][0].held.keys()]).toEqual([64]);
    // …so nothing is wrong and nothing is latched.
    expect(screen.getByTestId('keyboard')).toHaveAttribute('data-wrong', '');
    expect(screen.getByRole('status')).not.toHaveTextContent('That note was not expected');

    // Once RUNNING the matcher's normal rules apply to the whole held set, and
    // the stray is an extra like any other.
    hold(view, props, [67, 64, 60]);
    await waitFor(() => expect(screen.getByTestId('keyboard')).toHaveAttribute('data-wrong', '67'));

    // Lift it and the chord completes. It does not PASS — the extra cost it a
    // clean sheet, which is the matcher's ordinary rule and exactly the price
    // the arming boundary must not charge for a key the child never played at.
    hold(view, props, [64, 60]);
    expect(await screen.findByText('Practice complete')).toBeInTheDocument();
  });

  it.each([
    ['practice free', { intent: 'practice', practiceMode: 'free' }, 'Play the first note to begin.'],
    ['a free challenge', { intent: 'challenge', requirementOverride: { mode: 'free' } }, 'Play the first note to begin.'],
    ['a cued challenge', { intent: 'challenge', requirementOverride: requirementForRung(initialRung(), { passScore: 0.8 }) },
      "Press any key to start. You'll hear 4 clicks, then play at that speed."],
  ])('%s has no button to press and no fixed-tempo lecture', async (_label, extra, hint) => {
    h.instanceData = { ...h.instance, tempo: { start_bpm: 60 } };
    const props = { instanceId: h.instance.id, onExit: vi.fn(), onPassed: vi.fn(), ...extra };
    render(<ExerciseRun {...props} />);

    expect(await screen.findByText(hint)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /begin/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/tempo and pass criteria are fixed/)).not.toBeInTheDocument();
  });
});
