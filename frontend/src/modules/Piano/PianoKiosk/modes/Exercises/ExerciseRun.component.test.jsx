import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExerciseRun from './ExerciseRun.jsx';
import { requirementForRung } from '../Games/gameGateLadder.js';

const h = vi.hoisted(() => ({
  activeNotes: new Map(),
  record: vi.fn(),
  createAttempt: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: 'learner4' }) }));
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
    instance: vi.fn(async () => ({ ok: true, data: h.instance })),
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
});
