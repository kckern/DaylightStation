import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExerciseRun from './ExerciseRun.jsx';

const h = vi.hoisted(() => ({
  activeNotes: new Map(),
  record: vi.fn(),
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
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: 'felix' }) }));
vi.mock('../../../components/PianoKeyboard.jsx', () => ({ PianoKeyboard: () => <div data-testid="keyboard" /> }));
vi.mock('./ExerciseNotation.jsx', () => ({ default: ({ eventIndex }) => <div data-testid="notation">{eventIndex}</div> }));
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

describe('ExerciseRun shared assessment wiring', () => {
  beforeEach(() => {
    h.activeNotes = new Map();
    h.record.mockReset();
    h.record.mockResolvedValue({ ok: true, status: 201, data: { attempt_id: 'stored' }, durationMs: 4 });
    for (const logger of Object.values(h.log)) logger.mockClear();
  });

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
    expect(userId).toBe('felix');
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
});
