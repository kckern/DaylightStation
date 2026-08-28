import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExerciseRun from './ExerciseRun.jsx';
import { initialRung, requirementForRung } from '../Games/gameGateLadder.js';

const h = vi.hoisted(() => ({
  activeNotes: new Map(),
  record: vi.fn(),
  createAttempt: vi.fn(),
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
vi.mock('../SheetMusic/useMetronomeClick.js', () => ({ useMetronomeClick: vi.fn() }));
vi.mock('../../../performance/attemptEvidence.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, pianoAttemptClient: { record: h.record } };
});
vi.mock('../../../performance/assessmentSession.js', async (importOriginal) => {
  const actual = await importOriginal();
  h.createAttempt.mockImplementation(actual.createAssessmentAttempt);
  return { ...actual, createAssessmentAttempt: (...args) => h.createAttempt(...args) };
});

describe('ExerciseRun shared assessment wiring', () => {
  beforeEach(() => {
    h.activeNotes = new Map();
    h.instanceData = null;
    h.instanceOk = true;
    h.currentUser = 'learner4';
    h.record.mockReset();
    h.record.mockResolvedValue({ ok: true, status: 201, data: { attempt_id: 'stored' }, durationMs: 4 });
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

  it('drives MIDI through the shared cursor runtime and persists completed practice evidence', async () => {
    const props = { instanceId: h.instance.id, intent: 'practice', practiceMode: 'free', onExit: vi.fn(), onPassed: vi.fn() };
    const view = render(<ExerciseRun {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Begin practice' }));

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
    await screen.findByRole('button', { name: 'Begin challenge' });

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
    fireEvent.click(await screen.findByRole('button', { name: 'Begin practice' }));

    press(view, props, 61); // a semitone above the expected 60 — wrong, but plausible

    await waitFor(() => expect(screen.getByTestId('keyboard')).toHaveAttribute('data-wrong', '61'));
    expect(screen.getByRole('status')).toHaveTextContent('That note was not expected');
    // The notation only ever wanted a flag, and still gets exactly that.
    expect(screen.getByTestId('notation')).toHaveAttribute('data-wrong', 'true');

    press(view, props, 60); // a hit clears it
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
    fireEvent.click(await screen.findByRole('button', { name: 'Begin challenge' }));

    press(view, props, 61);
    press(view, props, 61);
    press(view, props, 61);
    press(view, props, 60);
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
    fireEvent.click(await screen.findByRole('button', { name: 'Begin challenge' }));

    press(view, props, 61);
    press(view, props, 61);
    press(view, props, 61);
    press(view, props, 60);
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
    fireEvent.click(await screen.findByRole('button', { name: 'Begin challenge' }));

    press(view, props, 60);
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
    fireEvent.click(await screen.findByRole('button', { name: 'Begin challenge' }));

    press(view, props, 61);
    press(view, props, 61);
    press(view, props, 61);
    press(view, props, 60);
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
    fireEvent.click(await screen.findByRole('button', { name: 'Begin challenge' }));

    press(view, props, 60);
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
    fireEvent.click(await screen.findByRole('button', { name: 'Begin challenge' }));

    press(view, props, 61);
    press(view, props, 61);
    press(view, props, 61);
    press(view, props, 60);
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
    fireEvent.click(await screen.findByRole('button', { name: 'Begin challenge' }));

    press(view, props, 61);
    press(view, props, 61);
    press(view, props, 61);
    press(view, props, 60);
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
    fireEvent.click(await screen.findByRole('button', { name: 'Begin challenge' }));

    press(view, props, 60);
    press(view, props, 62); // clean -> score 1

    expect(await screen.findByText('Passed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(props.onPassed).toHaveBeenCalledTimes(1);
  });
});
