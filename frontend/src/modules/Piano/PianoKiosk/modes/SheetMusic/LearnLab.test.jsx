import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LearnLab from './LearnLab.jsx';
import { createClickScheduler } from './clickScheduler.js';
import { useMetronomeClick } from './useMetronomeClick.js';

const exercise = vi.hoisted(() => ({ props: null }));
vi.mock('../Exercises/ExerciseRun.jsx', () => ({
  default: (props) => {
    exercise.props = props;
    return <button type="button" onClick={() => props.onPassed({ verdict: { passed: true } })}>Finish take</button>;
  },
}));

const segment = { id: 'm0-3', label: 'Segment 1', barLabel: 'Bars 1–4', printedMeasures: [1, 4], inMeasure: 0, outMeasure: 3 };
const rung = { id: 'right', label: 'Right hand', effectiveParts: ['rh'], mode: 'free', sets: 1, reps: 1, passCount: 0, required: 1, criteria: { completeness: 1 } };
const base = { score: { id: 'score', musicXml: '<score />' }, revision: 'rev', segment, rung, onRecord: vi.fn(), onClose: vi.fn() };

describe('LearnLab', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it('defaults to Loud and persists a selected click level for the next lab visit', () => {
    const timed = { ...rung, mode: 'cued' };
    const { unmount } = render(<LearnLab {...base} rung={timed} />);
    expect(screen.getByRole('group', { name: 'Metronome loudness' })).toBeInTheDocument();
    for (const label of ['Soft', 'Medium', 'Loud', 'Max']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Loud' })).toHaveAttribute('aria-pressed', 'true');
    expect(exercise.props.clickGain).toBe(0.36);
    const originalRunScore = exercise.props.score;
    fireEvent.click(screen.getByRole('button', { name: 'Soft' }));
    expect(exercise.props.clickGain).toBe(0.08);
    expect(exercise.props.score).toBe(originalRunScore);
    expect(screen.getByRole('button', { name: 'Soft' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('piano.learn.click-level')).toBe('soft');
    unmount();
    render(<LearnLab {...base} rung={timed} />);
    expect(screen.getByRole('button', { name: 'Soft' })).toHaveAttribute('aria-pressed', 'true');
    expect(exercise.props.clickGain).toBe(0.08);
  });

  it('keeps loudness usable when browser storage access throws', () => {
    const getter = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('blocked'); });
    try {
      render(<LearnLab {...base} rung={{ ...rung, mode: 'cued' }} />);
      expect(screen.getByRole('button', { name: 'Loud' })).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(screen.getByRole('button', { name: 'Max' }));
      expect(screen.getByRole('button', { name: 'Max' })).toHaveAttribute('aria-pressed', 'true');
      expect(exercise.props.clickGain).toBe(0.6);
    } finally { getter.mockRestore(); }
  });

  it('updates the anchored hook gain without replacing its scheduler or shifting beat phase', () => {
    vi.useFakeTimers();
    const ac = { currentTime: 0, state: 'running' };
    const beats = [];
    let starts = 0;
    let stops = 0;
    let created = 0;
    const createScheduler = () => {
      created += 1;
      const scheduler = createClickScheduler({ getCtx: () => ac, now: () => 1_000_000,
        scheduleBlip: (_a, t, options) => beats.push({ t: +t.toFixed(2), ...options }) });
      const start = scheduler.start;
      const stop = scheduler.stop;
      scheduler.start = (...args) => { starts += 1; return start(...args); };
      scheduler.stop = () => { stops += 1; stop(); };
      return scheduler;
    };
    const { rerender, unmount } = renderHook(({ gain }) => useMetronomeClick({
      enabled: true, bpm: 120, anchorMs: 1_000_100, beatsPerBar: 3, firstBeatIndex: 2, gain, createScheduler,
    }), { initialProps: { gain: 0.08 } });
    rerender({ gain: 0.6 });
    ac.currentTime = 0.4; act(() => vi.advanceTimersByTime(100));
    rerender({ gain: undefined });
    ac.currentTime = 0.9; act(() => vi.advanceTimersByTime(100));
    expect(beats).toEqual([
      { t: 0.1, accent: false, gain: 0.08 },
      { t: 0.6, accent: true, gain: 0.6 },
      { t: 1.1, accent: false, gain: 0.18 },
    ]);
    expect({ created, starts, stops }).toEqual({ created: 1, starts: 1, stops: 0 });
    unmount();
    expect(stops).toBe(1);
  });

  it('is a focused lab with a conventional close control and no roadmap copy', () => {
    render(<LearnLab {...base} />);
    expect(screen.getByRole('dialog', { name: 'Segment 1 · Right hand' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to Segment 1' })).toBeInTheDocument();
    expect(document.querySelector('.piano-learn-lab__toolbar')).toBeInTheDocument();
    expect(screen.getByText('Bars 1–4')).toBeInTheDocument();
    expect(screen.getByText('Set 1 of 1 · Rep 1 of 1')).toBeInTheDocument();
    expect(screen.queryByText(/roadmap/i)).not.toBeInTheDocument();
    expect(exercise.props.score).toMatchObject({ rangeIndices: { start: 0, end: 3 }, activeParts: ['rh'] });
    expect(exercise.props).toMatchObject({ scoreCursorPolicy: 'always', keyboardHintPolicy: 'after-wrong', surface: 'learn-lab' });
    expect(exercise.props.bare).toBeUndefined();
    expect(exercise.props.failurePresentation).toBe('local');
    expect(exercise.props.practiceRequirement.rubric.criteria).toEqual({ completeness: 1, cleanliness: 0.8 });
  });

  it('requires both hands at the same onset on the together rung', () => {
    render(<LearnLab {...base} rung={{ ...rung, id: 'together', effectiveParts: ['rh', 'lh'] }} />);
    expect(exercise.props.practiceRequirement.policy).toEqual({ requireConcurrentOnset: true });
  });

  it('reports rung completion so the host can advance according to its resolved plan', () => {
    vi.useFakeTimers();
    const onRungPassed = vi.fn();
    const onRecord = vi.fn(() => ({ rungComplete: true, passage: { complete: false } }));
    render(<LearnLab {...base} onRecord={onRecord} onRungPassed={onRungPassed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Finish take' }));
    expect(screen.getByRole('status')).toHaveTextContent('Right hand complete');
    expect(onRungPassed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(900);
    expect(onRungPassed).toHaveBeenCalledWith(expect.objectContaining({ segmentId: 'm0-3', rungId: 'right' }));
  });

  it('covers the next take with the shared rep interstitial instead of looking like a reload', () => {
    vi.useFakeTimers();
    const drill = { ...rung, sets: 2, reps: 2, required: 4, passCount: 0 };
    const onRecord = vi.fn(() => ({ rungComplete: false, passage: { complete: false } }));
    render(<LearnLab {...base} rung={drill} onRecord={onRecord} />);

    fireEvent.click(screen.getByRole('button', { name: 'Finish take' }));

    expect(screen.getByRole('status', { name: 'Rep 1 of 2. Passed. Rep 2 of 2.' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2199));
    expect(screen.getByRole('status', { name: 'Rep 1 of 2. Passed. Rep 2 of 2.' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status', { name: 'Rep 1 of 2. Passed. Rep 2 of 2.' })).not.toBeInTheDocument();
  });

  it('marks the boundary between sets in the interstitial', () => {
    const drill = { ...rung, sets: 2, reps: 2, required: 4, passCount: 1 };
    const onRecord = vi.fn(() => ({ rungComplete: false, passage: { complete: false } }));
    render(<LearnLab {...base} rung={drill} onRecord={onRecord} />);

    fireEvent.click(screen.getByRole('button', { name: 'Finish take' }));

    expect(screen.getByRole('status', { name: 'Set 1 of 2 clear. Passed. Next: Set 2, R.' })).toBeInTheDocument();
  });

  it('reports mastery separately and closes the lab', () => {
    vi.useFakeTimers();
    const onMastered = vi.fn();
    const onClose = vi.fn();
    const onRecord = vi.fn(() => ({ rungComplete: true, passage: { complete: true } }));
    render(<LearnLab {...base} onRecord={onRecord} onMastered={onMastered} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Finish take' }));
    expect(onMastered).toHaveBeenCalledWith('m0-3');
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(900);
    expect(onClose).toHaveBeenCalled();
  });

  it('returns to the selected segment when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<LearnLab {...base} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('advances through configured set percentages and carries the full score tempo source', () => {
    const timed = { ...rung, mode: 'cued', sets: 3, reps: 1, passCount: 1, required: 3, tempoPercent: 60, tempoPercents: [60, 75, 90] };
    render(<LearnLab {...base} rung={timed} tempo={{ tempoMap: [{ onsetQuarter: 0, bpm: 100 }, { onsetQuarter: 8, bpm: 80 }], tempoSource: 'musicxml', minimumPercent: 40, maximumPercent: 100 }} />);
    expect(screen.getByRole('button', { name: 'Choose tempo: Nearly there · 80 BPM' })).toBeInTheDocument();
    expect(exercise.props.score.tempoPercent).toBe(80);
    expect(exercise.props.traceContext.tempoSource).toBe('musicxml');
  });

  it('keeps learner controls within configured bounds', () => {
    const timed = { ...rung, mode: 'cued', tempoPercent: 60 };
    render(<LearnLab {...base} rung={timed} tempo={{ tempoMap: [{ onsetQuarter: 0, bpm: 100 }], tempoSource: 'musicxml', minimumPercent: 55, maximumPercent: 65 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose tempo: Steady · 60 BPM' }));
    expect(screen.getByRole('button', { name: 'Steady' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Very slow' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Full speed' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Steady' }));
    expect(exercise.props.score.tempoPercent).toBe(60);
  });

  it('forces mastery to 100% and labels an inferred fallback honestly', () => {
    const mastery = { ...rung, mode: 'cued', mastery: true, tempoPercent: 40 };
    render(<LearnLab {...base} rung={mastery} tempo={{ tempoMap: [{ onsetQuarter: 0, bpm: 90 }], tempoSource: 'inferred' }} />);
    expect(screen.getByText('Full speed · 90 BPM')).toBeInTheDocument();
    expect(screen.getByText('Fallback tempo')).toBeInTheDocument();
    expect(exercise.props.score.tempoPercent).toBe(100);
    expect(screen.queryByRole('button', { name: /Choose tempo/ })).not.toBeInTheDocument();
  });

  it('directly chooses Very slow and scales the original score contract to 25%', () => {
    render(<LearnLab {...base} rung={{ ...rung, mode: 'cued', tempoPercent: 60 }} tempo={{ tempoMap: [{ onsetQuarter: 0, bpm: 120 }], tempoSource: 'musicxml' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose tempo: Steady · 72 BPM' }));
    fireEvent.click(screen.getByRole('button', { name: 'Very slow' }));
    expect(exercise.props.score).toMatchObject({ tempoPercent: 25, musicXml: '<score />' });
    expect(screen.getByRole('button', { name: 'Choose tempo: Very slow · 30 BPM' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Practice tempo' })).not.toBeInTheDocument();
  });

  it('dismisses the tempo sheet with Escape while leaving the lab open', () => {
    const onClose = vi.fn();
    render(<LearnLab {...base} onClose={onClose} rung={{ ...rung, mode: 'cued', tempoPercent: 60 }} />);
    const launcher = screen.getByRole('button', { name: 'Choose tempo: Steady' });
    launcher.focus();
    fireEvent.click(launcher);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Practice tempo' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(launcher).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clamps the named selection into a narrow interval excluding standard stages', () => {
    render(<LearnLab {...base} rung={{ ...rung, mode: 'cued', tempoPercent: 100 }} tempo={{ minimumPercent: 61, maximumPercent: 65, tempoMap: [{ onsetQuarter: 0, bpm: 100 }] }} />);
    expect(exercise.props.score.tempoPercent).toBe(61);
    fireEvent.click(screen.getByRole('button', { name: 'Choose tempo: Steady · 61 BPM' }));
    fireEvent.click(screen.getByRole('button', { name: 'Steady' }));
    expect(exercise.props.score.tempoPercent).toBe(61);
  });

  it('keeps Test Out at Full speed despite bounded practice tempo', () => {
    render(<LearnLab {...base} rung={{ ...rung, mode: 'cued', completion: 'tested-out', tempoPercent: 25 }} tempo={{ minimumPercent: 25, maximumPercent: 60 }} />);
    expect(screen.getByText('Full speed')).toBeInTheDocument();
    expect(exercise.props.score.tempoPercent).toBe(100);
    expect(screen.queryByRole('button', { name: /Choose tempo/ })).not.toBeInTheDocument();
  });

  it('shows the named tempo as fixed when adjustments are disabled', () => {
    render(<LearnLab {...base} rung={{ ...rung, mode: 'cued', tempoPercent: 60 }} tempo={{ adjustable: false }} />);
    expect(screen.getByText('Steady')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Choose tempo/ })).not.toBeInTheDocument();
  });

  it('reports the passage failure detail instead of silently closing itself', () => {
    const onUnavailable = vi.fn();
    const onClose = vi.fn();
    render(<LearnLab {...base} onUnavailable={onUnavailable} onClose={onClose} />);
    exercise.props.onUnavailable('unrunnable', 'passage-too-dense');
    expect(onUnavailable).toHaveBeenCalledWith('passage-too-dense');
    expect(onClose).not.toHaveBeenCalled();
  });
});
