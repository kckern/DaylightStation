import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExerciseRun from './ExerciseRun.jsx';
import { BUILT_IN_FLOOR } from '../Games/gateRepertoire.js';
import { requirementForLevel } from '../Games/gateAsk.js';

/**
 * A host-supplied requirement carrying a NUMERIC bar, as a local fixture.
 *
 * The gate no longer produces one — every repertoire level is verdict-driven
 * (`requirementForLevel` returns `passScore: null`). But `ExerciseRun` still
 * honours `requirementOverride.passScore` for any host that sets one, program
 * steps included, and the specs below are that path's only coverage. Keeping
 * the shape here rather than importing it from a module the gate has retired
 * is what stops the coverage disappearing along with the ladder.
 */
const withPassScore = ({ mode = 'free', passScore }) => ({ mode, hands: 1, span: 1, passScore });
const cuedRequirement = ({ passScore }) => withPassScore({ mode: 'cued', passScore });

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
  // Every `deriveStage(tuple, instance)` call the run made, in order. Spied
  // through (the real function still decides the stage) so a test can assert
  // WHAT the run handed it — a tuple built by `askTupleFor`, not a tier
  // number — without weakening the truth-table proof that lives in
  // `askSchema.test.js`.
  deriveStageCalls: [],
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
// The other two stages, mocked at the same boundary and for the same reason:
// what is pinned here is which stage a tier mounts and what it is handed —
// KeysAsk and SvgSequenceStaff each have their own suite for their rendering.
vi.mock('./KeysAsk.jsx', () => ({
  default: (props) => (
    <div
      data-testid="keys-ask"
      data-wrong={props.wrongMidi ?? ''}
      data-cursor={props.cursorIndex}
      data-show-staff={String(Boolean(props.showStaff))}
      data-accidental={props.accidental}
      data-clef={props.clef ?? ''}
      data-events={(props.events ?? []).length}
    />
  ),
}));
// The renderer is doubled; `sequenceStaffViewBox` is NOT — the run uses it to
// size the staff's box, and a stubbed ratio would let a real sizing mistake
// through while the test kept measuring the stub's.
vi.mock('../../../../MusicNotation/renderers/SvgSequenceStaff.jsx', async (importOriginal) => ({
  ...(await importOriginal()),
  SvgSequenceStaff: (props) => (
    <div
      data-testid="sequence-staff"
      data-wrong={props.wrongMidi ?? ''}
      data-cursor={props.cursorIndex}
      data-clef={props.clef ?? ''}
      data-accidental={props.accidental}
      data-notes={JSON.stringify(props.notes)}
    />
  ),
}));
vi.mock('../../../ask/askSchema.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // A pass-through wrapper, not a double — same posture as the runtime spy
    // below: the real function still decides the stage, this only records how
    // it was called.
    deriveStage: (tuple, instance) => {
      h.deriveStageCalls.push({ tuple, instance });
      return actual.deriveStage(tuple, instance);
    },
  };
});
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

function resetHarness() {
  h.activeNotes = new Map();
  h.instanceData = null;
  h.instanceOk = true;
  h.currentUser = 'learner4';
  h.deriveStageCalls = [];
  h.record.mockReset();
  h.record.mockResolvedValue({ ok: true, status: 201, data: { attempt_id: 'stored' }, durationMs: 4 });
  h.start.mockClear();
  h.observe.mockClear();
  h.metronome.mockClear();
  // mockClear, not mockReset — the implementation is installed once by the
  // module factory and must survive between tests.
  h.createAttempt.mockClear();
  for (const logger of Object.values(h.log)) logger.mockClear();
}

// Press and release, so the next press of the same pitch is seen as a new onset.
function pressKey(view, props, midi) {
  act(() => { h.activeNotes = new Map([[midi, { velocity: 1 }]]); view.rerender(<ExerciseRun {...props} />); });
  act(() => { h.activeNotes = new Map(); view.rerender(<ExerciseRun {...props} />); });
}

describe('ExerciseRun shared assessment wiring', () => {
  beforeEach(resetHarness);

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
    // Free practice on sequential material is tier 2 now: the cursor this
    // watches lives on the sequence staff rather than the ABC notation. Same
    // cursor, same source (`eventIndex`) — only the stage that draws it moved.
    await waitFor(() => expect(screen.getByTestId('sequence-staff')).toHaveAttribute('data-cursor', '1'));
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
    // Tier 2's staff wants the PITCH, not a flag — it draws the wrong note at
    // its own position. (The ABC stage still gets the flag; that is asserted
    // in the tier-3 row of the stage-boundary table below.)
    expect(screen.getByTestId('sequence-staff')).toHaveAttribute('data-wrong', '61');

    press(view, props, 62); // a hit clears it
    await waitFor(() => expect(screen.getByTestId('keyboard')).toHaveAttribute('data-wrong', ''));
  });

  it('a completed floor attempt with N wrong notes still passes', async () => {
    // The repertoire floor: rubric `{criteria:{completeness:1}}`, cleanliness
    // deliberately absent. A child who has already walked the ladder to the
    // bottom must be able to finish. Wrong notes are recorded, not disqualifying.
    const requirementOverride = requirementForLevel(BUILT_IN_FLOOR);
    expect(requirementOverride.rubric).toEqual({ criteria: { completeness: 1 } });
    expect(requirementOverride.passScore).toBeNull();

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

  // A host requirement that carries a passScore and NO rubric: the engine's
  // `verdict.passed` is unconditionally true there, so the surface must judge
  // on the score or every child clears it instantly.

  it('a non-floor rung below its passScore is not a pass, whatever the engine verdict says', async () => {
    const requirementOverride = withPassScore({ passScore: 0.8 });
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
    const requirementOverride = withPassScore({ passScore: 0.8 });
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
    const requirementOverride = cuedRequirement({ passScore: 0.8 });
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
    const requirementOverride = withPassScore({ passScore: 0.8 });
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
    const requirementOverride = withPassScore({ passScore: 0.8 });
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
      requirementOverride: cuedRequirement({ passScore: 0.8 }),
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
      requirementOverride: cuedRequirement({ passScore: 0.8 }),
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
    const requirementOverride = withPassScore({ passScore: 0.8 });
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
    const requirementOverride = withPassScore({ passScore: 0.8 });
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
    const requirementOverride = withPassScore({ passScore: 0.8 });
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
    await waitFor(() => expect(screen.getByTestId('sequence-staff')).toHaveAttribute('data-cursor', '1'));
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
    expect(screen.getByTestId('sequence-staff')).toHaveAttribute('data-cursor', '0');
    expect(screen.getByTestId('keyboard')).toHaveAttribute('data-wrong', '');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('a cued ask arms on ANY key, counts in one measure, and does not grade the arming key', async () => {
    // 4/4 at 60bpm — one measure is exactly four seconds of count-in.
    h.instanceData = { ...h.instance, tempo: { start_bpm: 60 } };
    const requirementOverride = cuedRequirement({ passScore: 0.8 });
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
    const requirementOverride = cuedRequirement({ passScore: 0.8 });
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
    // …so nothing is wrong and nothing is latched. `ordering:'any'` material is
    // a lit-keys ask now, so the keyboard that shows this is KeysAsk's own —
    // the run has no footer strip under it to look at.
    expect(screen.getByTestId('keys-ask')).toHaveAttribute('data-wrong', '');
    expect(screen.getByRole('status')).not.toHaveTextContent('That note was not expected');

    // Once RUNNING the matcher's normal rules apply to the whole held set, and
    // the stray is an extra like any other.
    hold(view, props, [67, 64, 60]);
    await waitFor(() => expect(screen.getByTestId('keys-ask')).toHaveAttribute('data-wrong', '67'));

    // Lift it and the chord completes. It does not PASS — the extra cost it a
    // clean sheet, which is the matcher's ordinary rule and exactly the price
    // the arming boundary must not charge for a key the child never played at.
    hold(view, props, [64, 60]);
    expect(await screen.findByText('Practice complete')).toBeInTheDocument();
  });

  it('observes EVERY note of a co-arriving pair, so a two-hand ask leaves event zero', async () => {
    // Two keys struck together arrive in ONE commit. `previousNotesRef`
    // consumes both, so a companion note not observed at the arming boundary
    // can never become an onset again while it is held — on Hanon-shaped
    // material (every event a left/right pair) that is a cursor latched on
    // event zero at a run the child played correctly.
    h.instanceData = {
      ...h.instance,
      events: [
        { id: 'first', value: 'quarter', notes: [{ midi: 48, hand: 'left' }, { midi: 60, hand: 'right' }] },
        { id: 'second', value: 'quarter', notes: [{ midi: 50, hand: 'left' }, { midi: 62, hand: 'right' }] },
      ],
    };
    const props = { instanceId: h.instance.id, intent: 'practice', practiceMode: 'free', onExit: vi.fn(), onPassed: vi.fn() };
    const view = render(<ExerciseRun {...props} />);
    await screen.findByText('Play the first note to begin.');

    hold(view, props, [48, 60]); // both notes of event zero, in one commit

    expect(h.start).toHaveBeenCalledWith({ leadInMs: 0, clock: 'date-now' });
    // The arming note is still FIRST — it is the note that started the run and
    // must stay the run's first graded note.
    expect(h.observe.mock.calls.map((call) => call[0].midi)).toEqual([48, 60]);
    // Two-hand material draws on the grand staff (`sequenceStaffCanDraw`), so
    // the cursor to read is the ABC path's — same cursor, same `eventIndex`.
    await waitFor(() => expect(screen.getByTestId('notation')).toHaveTextContent('1'));
  });

  it.each([
    ['practice free', { intent: 'practice', practiceMode: 'free' }, 'Play the first note to begin.'],
    ['a free challenge', { intent: 'challenge', requirementOverride: { mode: 'free' } }, 'Play the first note to begin.'],
    ['a cued challenge', { intent: 'challenge', requirementOverride: cuedRequirement({ passScore: 0.8 }) },
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

/**
 * The rung decides what the screen is. Everything below is about what a child
 * SEES at a given tier — which stage is mounted, what the header says, and
 * whether a number appears at the end — never about how the run is graded.
 */
describe('ExerciseRun tier-driven presentation', () => {
  beforeEach(resetHarness);

  const STAGES = ['keys-ask', 'sequence-staff', 'notation'];
  const practice = (extra = {}) => ({
    instanceId: h.instance.id, intent: 'practice', practiceMode: 'free',
    onExit: vi.fn(), onPassed: vi.fn(), ...extra,
  });

  const ready = () => screen.findByText('Play the first note to begin.');

  it('wears the framing a host gave it, and the intent label when it was given none', async () => {
    const props = practice({ framing: 'Play this to start Tetris' });
    const view = render(<ExerciseRun {...props} />);
    await ready();
    expect(screen.getByText('Play this to start Tetris')).toBeInTheDocument();
    // The framing REPLACES the intent label; a child should not read both.
    expect(screen.queryByText('Practice')).not.toBeInTheDocument();

    view.unmount();
    const plain = practice();
    render(<ExerciseRun {...plain} />);
    await ready();
    expect(screen.getByText('Practice')).toBeInTheDocument();
  });

  it.each([[0], [1], [2], [3]])('tier %i reads its ask out before a note is played', async (tier) => {
    const props = practice({ tier, ask: 'Play the lit keys in order.' });
    render(<ExerciseRun {...props} />);
    await ready();
    expect(screen.getByRole('heading', { name: 'Play the lit keys in order.' })).toBeInTheDocument();
    // The exercise's own title is what a caller WITHOUT an ask keeps; it is not
    // a second line under the ask.
    expect(screen.queryByText('C major fragment')).not.toBeInTheDocument();
  });

  it('keeps the exercise title as the heading when no ask was given', async () => {
    render(<ExerciseRun {...practice()} />);
    await ready();
    expect(screen.getByRole('heading', { name: 'C major fragment' })).toBeInTheDocument();
  });

  it('labels the key chip, and drops it entirely where there is no staff to read', async () => {
    const view = render(<ExerciseRun {...practice({ tier: 2 })} />);
    await ready();
    expect(screen.getByText('Key of C')).toBeInTheDocument();

    view.unmount();
    render(<ExerciseRun {...practice({ tier: 0 })} />);
    await ready();
    expect(screen.queryByText(/Key of/)).not.toBeInTheDocument();
    // …and the bare letter that used to stand there is gone with it: an
    // unlabeled "C" on a screen with no staff names nothing a child can use.
    expect(screen.queryByText('C')).not.toBeInTheDocument();
  });

  it.each([
    [0, 'keys-ask', '61'],
    [1, 'keys-ask', '61'],
    [2, 'sequence-staff', '61'],
    // The ABC path only ever wanted a flag, and still gets exactly that.
    [3, 'notation', 'true'],
  ])('tier %i mounts the %s stage alone, and gives it the wrong note', async (tier, stage, wrong) => {
    const props = practice({ tier });
    const view = render(<ExerciseRun {...props} />);
    await ready();

    expect(screen.getByTestId(stage)).toBeInTheDocument();
    for (const other of STAGES.filter((id) => id !== stage)) {
      expect(screen.queryByTestId(other)).not.toBeInTheDocument();
    }

    pressKey(view, props, 60); // arms the run and grades event one
    pressKey(view, props, 61); // a semitone below the expected 62
    await waitFor(() => expect(screen.getByTestId(stage)).toHaveAttribute('data-wrong', wrong));
  });

  it.each([[0, 'false'], [1, 'true']])('tier %i gets the keys ask with showStaff=%s', async (tier, shown) => {
    render(<ExerciseRun {...practice({ tier })} />);
    await ready();
    expect(screen.getByTestId('keys-ask')).toHaveAttribute('data-show-staff', shown);
    // KeysAsk brings its own keyboard — a footer strip under it would be a
    // second piano on the same screen.
    expect(screen.queryByTestId('keyboard')).not.toBeInTheDocument();
  });

  it.each([[2], [3]])('tier %i keeps the keyboard footer under its staff', async (tier) => {
    render(<ExerciseRun {...practice({ tier })} />);
    await ready();
    expect(screen.getByTestId('keyboard')).toBeInTheDocument();
  });

  it('advances the new stages on the same cursor the ABC path uses', async () => {
    const props = practice({ tier: 2 });
    const view = render(<ExerciseRun {...props} />);
    await ready();
    expect(screen.getByTestId('sequence-staff')).toHaveAttribute('data-cursor', '0');

    pressKey(view, props, 60);
    await waitFor(() => expect(screen.getByTestId('sequence-staff')).toHaveAttribute('data-cursor', '1'));
  });

  it('spells the sequence staff for the key it is actually in', async () => {
    // The staff's own default is 'sharp', which renders the B♭ of F major as
    // A♯ — the wrong letter, on the surface a child is reading letters from.
    h.instanceData = {
      ...h.instance,
      key: 'F',
      events: [
        { id: 'first', value: 'quarter', notes: [{ midi: 65, hand: 'right' }] },
        { id: 'second', value: 'quarter', notes: [{ midi: 70, hand: 'right' }] },
      ],
    };
    render(<ExerciseRun {...practice({ tier: 2 })} />);
    await ready();
    const staff = screen.getByTestId('sequence-staff');
    expect(staff).toHaveAttribute('data-accidental', 'flat');
    expect(staff).toHaveAttribute('data-clef', 'treble');
    expect(staff).toHaveAttribute('data-notes', JSON.stringify([{ midi: 65 }, { midi: 70 }]));
  });

  it('spells a MINOR instance off its mode axis, not off the root the bank names', async () => {
    // The bank writes `key` as the root alone ('D') and the quality on an axis,
    // so reading `instance.key` by itself gives D major's two sharps and draws
    // D minor's B♭ as A♯. This is the seam that re-joins them.
    h.instanceData = {
      ...h.instance,
      key: 'D',
      axes: { root: 'D', mode: 'aeolian' },
      events: [
        { id: 'first', value: 'quarter', notes: [{ midi: 62, hand: 'right' }] },
        { id: 'second', value: 'quarter', notes: [{ midi: 70, hand: 'right' }] },
      ],
    };
    render(<ExerciseRun {...practice({ tier: 2 })} />);
    await ready();
    expect(screen.getByTestId('sequence-staff')).toHaveAttribute('data-accidental', 'flat');
  });

  it('puts a left-hand ask on a bass staff', async () => {
    h.instanceData = {
      ...h.instance,
      events: [
        { id: 'first', value: 'quarter', notes: [{ midi: 48, hand: 'left' }] },
        { id: 'second', value: 'quarter', notes: [{ midi: 50, hand: 'left' }] },
      ],
    };
    render(<ExerciseRun {...practice({ tier: 2 })} />);
    await ready();
    expect(screen.getByTestId('sequence-staff')).toHaveAttribute('data-clef', 'bass');
  });

  it('tells a tier-0 child how it went in words, with no percentage anywhere', async () => {
    const props = practice({ tier: 0 });
    const view = render(<ExerciseRun {...props} />);
    await ready();
    pressKey(view, props, 60);
    pressKey(view, props, 62);

    const panel = (await screen.findByText('Passed')).closest('.piano-exercise-run__result');
    expect(panel).not.toBeNull();
    expect(panel.textContent).not.toMatch(/%/);
    // A number that is not a percentage is not a loophole either: nothing on
    // this panel is a score.
    expect(panel.querySelector('dl')).toBeNull();
  });

  it('tells a tier-0 child what to do when the notes are still missing', async () => {
    // The failure half of the same panel, and it is the run's own: no host took
    // `onFailed`, so this is the only thing on screen.
    const props = {
      instanceId: h.instance.id, intent: 'challenge', tier: 0,
      requirementOverride: withPassScore({ passScore: 0.8 }),
      onExit: vi.fn(), onPassed: vi.fn(),
    };
    const view = render(<ExerciseRun {...props} />);
    await ready();
    pressKey(view, props, 60);
    for (const midi of [61, 61, 61]) pressKey(view, props, midi);
    pressKey(view, props, 62); // complete, score 0.7 — under the bar

    const panel = (await screen.findByText('Keep working')).closest('.piano-exercise-run__result');
    expect(panel.textContent).toContain('Some of the notes are still missing. Have another go.');
    expect(panel.textContent).not.toMatch(/%/);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows the staff for a low ask and leaves the clef to the one place that derives it', async () => {
    // A tie in the staff's own majority rule goes treble, which would put G3
    // five steps below the bottom line — off the card. The run's job here is
    // the DECISION that a staff fits at all (`staffFitsAsk`); the clef it fits
    // on is `clefForAsk` on these same events, which is exactly what KeysAsk's
    // own default answers with. Computing it a second time here would be a
    // second place for it to drift, so the prop is deliberately not passed —
    // the clef that reaches a child is pinned by KeysAsk.test.jsx ("answers
    // with the ask's own clef when the host named none") and, on real
    // engraved geometry, by ExerciseRun.measure.test.jsx's G3+C4 case.
    h.instanceData = {
      ...h.instance,
      events: [
        { id: 'first', value: 'quarter', notes: [{ midi: 55, hand: 'left' }] },
        { id: 'second', value: 'quarter', notes: [{ midi: 60, hand: 'left' }] },
      ],
    };
    render(<ExerciseRun {...practice({ tier: 1 })} />);
    await ready();
    const keys = screen.getByTestId('keys-ask');
    expect(keys).toHaveAttribute('data-show-staff', 'true');
    expect(keys).toHaveAttribute('data-clef', '');
  });

  it('says so when a tier it cannot use arrives, and falls back to derivation', async () => {
    // The caller that will pass this reads it out of authored config, where a
    // string, a float, or an out-of-range band are all one typo away — and a
    // tier that never arrives looks exactly like a tier nobody set.
    render(<ExerciseRun {...practice({ tier: '2' })} />);
    await ready();
    expect(h.log.warn).toHaveBeenCalledWith('piano.exercise-tier-invalid', { tier: '2', type: 'string' });
    // Derivation still runs: sequential free practice is tier 2.
    expect(screen.getByTestId('sequence-staff')).toBeInTheDocument();
  });

  it.each([[2.5], [4], [-1]])('refuses tier %s the same way', async (bad) => {
    render(<ExerciseRun {...practice({ tier: bad })} />);
    await ready();
    expect(h.log.warn).toHaveBeenCalledWith('piano.exercise-tier-invalid', { tier: bad, type: 'number' });
  });

  it('says nothing at all when no tier was given', async () => {
    render(<ExerciseRun {...practice()} />);
    await ready();
    expect(h.log.warn).not.toHaveBeenCalledWith('piano.exercise-tier-invalid', expect.anything());
  });

  it('keeps the score readout at tier 2', async () => {
    const props = practice({ tier: 2 });
    const view = render(<ExerciseRun {...props} />);
    await ready();
    pressKey(view, props, 60);
    pressKey(view, props, 62);

    const panel = (await screen.findByText('Passed')).closest('.piano-exercise-run__result');
    expect(panel.textContent).toMatch(/100%/);
  });

  it('an ordering:any practice ask gets lit keys, not the grand staff', async () => {
    // The deliberate practice-surface change: the intervals browser used to
    // render this material through instanceToAbc's `ordering:'any'` branch.
    h.instanceData = {
      ...h.instance,
      ordering: 'any',
      key: 'F',
      events: [{ id: 'chord', value: 'quarter', notes: [{ midi: 65, hand: 'right' }, { midi: 69, hand: 'right' }] }],
    };
    render(<ExerciseRun {...practice()} />); // no tier prop — a legacy caller
    await ready();

    expect(screen.getByTestId('keys-ask')).toBeInTheDocument();
    expect(screen.queryByTestId('notation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sequence-staff')).not.toBeInTheDocument();
    // Tier-1 treatment: the small staff comes along, spelled for the key.
    expect(screen.getByTestId('keys-ask')).toHaveAttribute('data-show-staff', 'true');
    expect(screen.getByTestId('keys-ask')).toHaveAttribute('data-accidental', 'flat');
  });

  it('keeps Hanon on the grand staff instead of squashing it onto one clef', async () => {
    // The real shape, off the bank: `staff: grand`, both hands on every event,
    // midi 36 to 91. As ordinary `ordering:'strict'` free material it derived
    // tier 2 and got the one-staff sequence renderer — a fixed 112-unit-tall
    // box, one treble clef, 42% of the notes off-canvas at a 20:1 aspect. The
    // ABC path draws it correctly and keeps it.
    h.instanceData = {
      ...h.instance,
      staff: 'grand',
      meter: '2/4',
      events: [
        { id: 'e1', value: '16th', notes: [{ midi: 36, hand: 'left', finger: 5 }, { midi: 48, hand: 'right', finger: 1 }] },
        { id: 'e2', value: '16th', notes: [{ midi: 40, hand: 'left', finger: 4 }, { midi: 52, hand: 'right', finger: 2 }] },
        { id: 'e3', value: '16th', notes: [{ midi: 79, hand: 'left', finger: 1 }, { midi: 91, hand: 'right', finger: 5 }] },
      ],
    };
    render(<ExerciseRun {...practice()} />); // no tier prop — derives 2
    await ready();

    expect(screen.getByTestId('notation')).toBeInTheDocument();
    expect(screen.queryByTestId('sequence-staff')).not.toBeInTheDocument();
    expect(screen.queryByTestId('keys-ask')).not.toBeInTheDocument();
  });

  it('a sequential practice ask still derives the staff it always had', async () => {
    render(<ExerciseRun {...practice()} />); // no tier prop
    await ready();
    expect(screen.getByTestId('sequence-staff')).toBeInTheDocument();
    expect(screen.queryByTestId('notation')).not.toBeInTheDocument();
  });

  it('a cued requirement derives tier 3 — the ABC notation, as before', async () => {
    const props = {
      instanceId: h.instance.id, intent: 'challenge',
      requirementOverride: cuedRequirement({ passScore: 0.8 }),
      onExit: vi.fn(), onPassed: vi.fn(),
    };
    render(<ExerciseRun {...props} />);
    await screen.findByText(/Press any key to start/);
    expect(screen.getByTestId('notation')).toBeInTheDocument();
    expect(screen.queryByTestId('keys-ask')).not.toBeInTheDocument();
  });

  it('shows the meter only for a cued ask', async () => {
    const view = render(<ExerciseRun {...practice()} />);
    await ready();
    expect(screen.queryByText('4/4')).not.toBeInTheDocument();

    view.unmount();
    render(<ExerciseRun {...{
      instanceId: h.instance.id, intent: 'challenge',
      requirementOverride: cuedRequirement({ passScore: 0.8 }),
      onExit: vi.fn(), onPassed: vi.fn(),
    }} />);
    await screen.findByText(/Press any key to start/);
    expect(screen.getByText('4/4')).toBeInTheDocument();
  });

  it('shows a BPM chip only where a pace gate actually exists', async () => {
    const view = render(<ExerciseRun {...{
      instanceId: h.instance.id, intent: 'challenge',
      requirementOverride: { mode: 'free' },
      onExit: vi.fn(), onPassed: vi.fn(),
    }} />);
    await ready();
    expect(screen.queryByText(/BPM/)).not.toBeInTheDocument();

    view.unmount();
    // A pace gate only exists in cued mode — the engine rejects one anywhere
    // else outright (`A pace gate requires cued mode`).
    render(<ExerciseRun {...{
      instanceId: h.instance.id, intent: 'challenge',
      requirementOverride: { mode: 'cued', gates: { pace: { target_bpm: 72 } } },
      onExit: vi.fn(), onPassed: vi.fn(),
    }} />);
    await screen.findByText(/Press any key to start/);
    expect(screen.getByText('72 BPM')).toBeInTheDocument();
  });
});

/**
 * The stage-selection CALL PATH (ask-platform SP1, task 5b).
 *
 * The suite above already proves the resulting DOM is unchanged — the same
 * `keys-ask`/`sequence-staff`/`notation` testids mount for the same tiers,
 * unmodified by this task. What it cannot show is HOW the run got there: this
 * describe asserts the run now consults `deriveStage` with a TUPLE built by
 * `askTupleFor({ tier: runTier }, null)` — the object `askSchema.test.js`'s
 * 16-cell table already proves routes identically to the retired
 * `stageForTier(runTier, instance)` — rather than handing a bare tier number
 * to a tier-shaped function.
 */
describe('ExerciseRun stage selection — consults deriveStage via askTupleFor', () => {
  beforeEach(resetHarness);
  const practice = (extra = {}) => ({
    instanceId: h.instance.id, intent: 'practice', practiceMode: 'free',
    onExit: vi.fn(), onPassed: vi.fn(), ...extra,
  });
  const ready = () => screen.findByText('Play the first note to begin.');

  it.each([
    [0, { prompt: 'follow', secondary: 'none', timing: 'free', judging: 'completion' }],
    [1, { prompt: 'follow', secondary: 'staff', timing: 'free', judging: 'completion' }],
    [2, { prompt: 'read', secondary: 'keyboard-strip', notationStyle: 'sequence', timing: 'free', judging: 'completion' }],
    [3, { prompt: 'read', secondary: 'keyboard-strip', notationStyle: 'engraved', timing: 'cued', judging: 'placed' }],
  ])('tier %i hands deriveStage the tier-%i preset tuple, not the number %i', async (tier, tuple) => {
    render(<ExerciseRun {...practice({ tier })} />);
    await ready();
    expect(h.deriveStageCalls.length).toBeGreaterThan(0);
    const call = h.deriveStageCalls.at(-1);
    expect(call.tuple).toEqual(tuple);
    expect(call.instance).toBe(h.instance);
    // The old signature's first argument was the NUMBER itself.
    expect(typeof call.tuple).toBe('object');
  });

  it('ordering:any material still overrides the tuple at deriveStage, not before it', async () => {
    // Tier 2's tuple says `notationStyle: 'sequence'` — deriveStage, not the
    // run, is what reads `instance.ordering` and answers 'keys' anyway. This
    // is the assertion that the INSTANCE, not just the tuple, reaches the call.
    h.instanceData = { ...h.instance, ordering: 'any' };
    render(<ExerciseRun {...practice({ tier: 2 })} />);
    await ready();
    const call = h.deriveStageCalls.at(-1);
    expect(call.tuple.notationStyle).toBe('sequence');
    expect(call.instance.ordering).toBe('any');
    expect(screen.getByTestId('keys-ask')).toBeInTheDocument();
  });

  it('a tier the run derives (no tier prop) still reaches deriveStage as a tuple', async () => {
    // No `tier` prop: `deriveRunTier` picks 2 for sequential free material —
    // the fallback path, proven here to feed the SAME tuple-building call.
    render(<ExerciseRun {...practice()} />);
    await ready();
    const call = h.deriveStageCalls.at(-1);
    expect(call.tuple).toEqual({
      prompt: 'read', secondary: 'keyboard-strip', notationStyle: 'sequence', timing: 'free', judging: 'completion',
    });
  });
});

/**
 * The stall — the only way a FREE challenge can fail.
 *
 * A free attempt produces no misses (there is no beat to be late for), so
 * completeness only ever rises and a completeness-only rubric — every tier 0-2
 * level, which is D9's whole point — is satisfied the instant the last note
 * lands and at no point before it. `verdict.passed` is therefore true by
 * construction at completion and the attempt simply never terminates otherwise:
 * a child who cannot play the ask sat on a `running` attempt forever, with no
 * result, no fail panel, no ladder movement, and Exit as the only way out —
 * which costs them the match they earned.
 *
 * Twenty seconds with no note-on ends it. The two rulings it must not break are
 * both pinned below: wrong notes stay recorded-never-disqualifying (nothing
 * here adds a cleanliness or passScore bar to a free level), and an attempt
 * with no musical input in it is never a failure.
 */
describe('ExerciseRun free-challenge stall', () => {
  beforeEach(() => {
    resetHarness();
    // `shouldAdvanceTime` keeps the real clock driving the fake one, so
    // `findBy*`/`waitFor` still resolve normally while `advanceTimersByTime`
    // can still jump the twenty seconds this suite is about.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => { vi.useRealTimers(); });

  /** Six notes — long enough that a child can play three and still be stuck. */
  const SIX_NOTES = [60, 62, 64, 65, 67, 69];
  const longInstance = () => ({
    ...h.instance,
    events: SIX_NOTES.map((midi, index) => ({
      id: `e${index + 1}`, value: 'quarter', notes: [{ midi, hand: 'right' }],
    })),
  });

  const press = (view, props, midi) => {
    act(() => { h.activeNotes = new Map([[midi, { velocity: 1 }]]); view.rerender(<ExerciseRun {...props} />); });
    act(() => { h.activeNotes = new Map(); view.rerender(<ExerciseRun {...props} />); });
  };
  /**
   * Advance the clock by `ms` of a child doing nothing.
   *
   * The 60ms preamble is not padding: the runtime publishes its store snapshot
   * on a 50ms throttle, so `musicalInput` — and with it the stall clock — only
   * reaches React one tick after the note that set it. Jumping straight to
   * 20,000 would arm the timer at 20,050 and land the test in a run that is
   * still going, which reads exactly like a stall that does not work.
   */
  const wait = async (ms) => {
    await act(async () => { vi.advanceTimersByTime(60); });
    await act(async () => { vi.advanceTimersByTime(ms); });
  };

  const freeChallenge = (extra = {}) => ({
    instanceId: h.instance.id,
    intent: 'challenge',
    // The shape a repertoire level actually produces: completeness-only, no
    // numeric bar. Nothing below may quietly add one.
    requirementOverride: { mode: 'free', rubric: { criteria: { completeness: 1 } }, passScore: null },
    onExit: vi.fn(), onPassed: vi.fn(), onFailed: vi.fn(), ...extra,
  });

  it('ends a stuck attempt as a judged failure and reports it to the host', async () => {
    h.instanceData = longInstance();
    const props = freeChallenge();
    const view = render(<ExerciseRun {...props} />);
    await screen.findByText('Play the first note to begin.');

    for (const midi of [60, 62, 64]) press(view, props, midi); // three right, then stuck
    await waitFor(() => expect(screen.getByTestId('sequence-staff')).toHaveAttribute('data-cursor', '3'));
    expect(props.onFailed).not.toHaveBeenCalled();

    await wait(20000);

    await waitFor(() => expect(props.onFailed).toHaveBeenCalledTimes(1));
    // A terminated attempt is finalized WITHOUT a verdict — which is what makes
    // `runPassed` answer false on its own rather than by assertion here.
    const result = props.onFailed.mock.calls[0][0];
    expect(result.status).toBe('timeout');
    expect(result.verdict).toBeUndefined();
    expect(result.diagnostics).toMatchObject({ expected_notes: 6, matched_notes: 3, missed_notes: 3 });
    expect(props.onPassed).not.toHaveBeenCalled();
    expect(props.onExit).not.toHaveBeenCalled();
    expect(h.log.info).toHaveBeenCalledWith('piano.exercise-stalled', expect.objectContaining({
      id: h.instance.id, matcher: 'cursor', stallMs: 20000, matched_notes: 3,
    }));
  });

  it('shows the ordinary fail panel — and no percentage — when no host took onFailed', async () => {
    // Without this, the stall would end the attempt and leave the child looking
    // at "Follow the highlighted notes" on a run nothing is listening to.
    h.instanceData = longInstance();
    const props = freeChallenge({ onFailed: undefined });
    const view = render(<ExerciseRun {...props} />);
    await screen.findByText('Play the first note to begin.');
    press(view, props, 60);

    await wait(20000);

    const panel = (await screen.findByText('Keep working')).closest('.piano-exercise-run__result');
    expect(panel.textContent).toContain('Some of the notes are still missing. Have another go.');
    // A stalled attempt has no score and no criteria at all; there is no number
    // to show and none is invented.
    expect(panel.textContent).not.toMatch(/%/);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Practice first' })).toBeInTheDocument();
  });

  it('persists the stall with its own status rather than dressing it as completed', async () => {
    h.instanceData = longInstance();
    const props = freeChallenge();
    const view = render(<ExerciseRun {...props} />);
    await screen.findByText('Play the first note to begin.');
    press(view, props, 60);

    await wait(20000);

    await waitFor(() => expect(h.record).toHaveBeenCalledTimes(1));
    expect(h.record.mock.calls[0][1]).toMatchObject({ status: 'timeout', purpose: 'challenge' });
  });

  it('resets the clock on every note, so a child working slowly is never interrupted', async () => {
    // Nineteen seconds between notes, five times over — 95 seconds of a run
    // that a single un-reset twenty-second timer would have killed four times.
    h.instanceData = longInstance();
    const props = freeChallenge();
    const view = render(<ExerciseRun {...props} />);
    await screen.findByText('Play the first note to begin.');

    for (const midi of SIX_NOTES) {
      press(view, props, midi);
      await wait(19000);
      expect(props.onFailed).not.toHaveBeenCalled();
    }

    expect(await screen.findByText('Passed')).toBeInTheDocument();
    expect(props.onFailed).not.toHaveBeenCalled();
  });

  it('never stalls before a note is played — a walk-away is an abandonment, not a failure', async () => {
    // The exit-fifteen-times-to-reach-the-floor exploit. An attempt with no
    // musical input in it must never move a ladder, so it must never become a
    // failure however long it sits on screen.
    h.instanceData = longInstance();
    const props = freeChallenge();
    const view = render(<ExerciseRun {...props} />);
    await screen.findByText('Play the first note to begin.');

    await wait(120000);

    expect(props.onFailed).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
    expect(screen.getByText('Play the first note to begin.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect(props.onExit).toHaveBeenCalledTimes(1);
    expect(props.onFailed).not.toHaveBeenCalled();
    view.unmount();
  });

  it('does not stall practice, which has no ladder to move', async () => {
    h.instanceData = longInstance();
    const props = { instanceId: h.instance.id, intent: 'practice', practiceMode: 'free', onExit: vi.fn(), onPassed: vi.fn() };
    const view = render(<ExerciseRun {...props} />);
    await screen.findByText('Play the first note to begin.');
    press(view, props, 60);

    await wait(120000);

    expect(screen.getByRole('status')).toHaveTextContent('Follow the highlighted notes.');
    expect(screen.queryByText('Practice complete')).not.toBeInTheDocument();
    expect(h.log.info).not.toHaveBeenCalledWith('piano.exercise-stalled', expect.anything());
  });

  it('does not stall a cued challenge, which already fails on its own', async () => {
    // The timed matcher misses notes that never arrive, so a cued ask reaches a
    // completed failure by itself. A stall on top would be a second clock.
    h.instanceData = { ...longInstance(), tempo: { start_bpm: 60 } };
    const props = freeChallenge({
      requirementOverride: { mode: 'cued', rubric: { criteria: { completeness: 1, cleanliness: 0.8 } }, passScore: null },
    });
    const view = render(<ExerciseRun {...props} />);
    await screen.findByText(/Press any key to start/);
    press(view, props, 60);

    await wait(20000);

    expect(h.log.info).not.toHaveBeenCalledWith('piano.exercise-stalled', expect.anything());
    view.unmount();
  });

  it('a wrong note is still a note: it feeds the stall clock and never disqualifies', async () => {
    // D9 and the child contract. Nothing added here may make a wrong key fail a
    // free level — it keeps the child alive on the clock instead.
    h.instanceData = longInstance();
    const props = freeChallenge();
    const view = render(<ExerciseRun {...props} />);
    await screen.findByText('Play the first note to begin.');
    press(view, props, 60);
    await wait(19000);
    press(view, props, 61); // wrong, and plausible — recorded, never fatal
    await wait(19000);
    expect(props.onFailed).not.toHaveBeenCalled();

    for (const midi of [62, 64, 65, 67, 69]) press(view, props, midi);
    expect(await screen.findByText('Passed')).toBeInTheDocument();
    expect(props.onFailed).not.toHaveBeenCalled();
  });
});

/**
 * The metronome pre-pulse's budget. The pulse exists so the grid is audible
 * BEFORE the first note (the first note is what starts the run), and nothing
 * stopped it: a kiosk left on this screen clicked at an empty room until
 * someone closed the tab.
 */
describe('ExerciseRun metronome pre-pulse', () => {
  beforeEach(() => {
    resetHarness();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => { vi.useRealTimers(); });

  const metronomePractice = () => ({
    instanceId: h.instance.id, intent: 'practice', practiceMode: 'metronome',
    onExit: vi.fn(), onPassed: vi.fn(),
  });

  it('stops clicking after a minute at a piano nobody armed', async () => {
    const props = metronomePractice();
    render(<ExerciseRun {...props} />);
    await screen.findByText('Play the first note to begin.');
    expect(h.metronome.mock.calls.at(-1)[0]).toMatchObject({ enabled: true, bpm: 90 });

    act(() => { vi.advanceTimersByTime(59000); });
    expect(h.metronome.mock.calls.at(-1)[0]).toMatchObject({ enabled: true });

    act(() => { vi.advanceTimersByTime(1000); });
    await waitFor(() => expect(h.metronome.mock.calls.at(-1)[0]).toMatchObject({ enabled: false }));
    // The screen is unchanged — the child still arms by playing, and the run
    // brings its own click when it does.
    expect(screen.getByText('Play the first note to begin.')).toBeInTheDocument();
  });

  it('keeps clicking through the run once a child arms it', async () => {
    const props = metronomePractice();
    const view = render(<ExerciseRun {...props} />);
    await screen.findByText('Play the first note to begin.');

    act(() => { h.activeNotes = new Map([[60, { velocity: 1 }]]); view.rerender(<ExerciseRun {...props} />); });
    act(() => { h.activeNotes = new Map(); view.rerender(<ExerciseRun {...props} />); });

    act(() => { vi.advanceTimersByTime(120000); });
    expect(h.metronome.mock.calls.at(-1)[0]).toMatchObject({ enabled: true, bpm: 90 });
  });
});
