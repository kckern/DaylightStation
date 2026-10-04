import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LearnLab from './LearnLab.jsx';

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
  afterEach(() => vi.useRealTimers());

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
    expect(screen.getByText('75% of score tempo · 75 BPM')).toBeInTheDocument();
    expect(exercise.props.score.tempoPercent).toBe(75);
  });

  it('keeps learner controls within configured bounds', () => {
    const timed = { ...rung, mode: 'cued', tempoPercent: 60 };
    render(<LearnLab {...base} rung={timed} tempo={{ tempoMap: [{ onsetQuarter: 0, bpm: 100 }], tempoSource: 'musicxml', minimumPercent: 55, maximumPercent: 65 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Increase tempo' }));
    expect(exercise.props.score.tempoPercent).toBe(65);
    expect(screen.getByRole('button', { name: 'Increase tempo' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Decrease tempo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decrease tempo' }));
    expect(exercise.props.score.tempoPercent).toBe(55);
    expect(screen.getByRole('button', { name: 'Decrease tempo' })).toBeDisabled();
  });

  it('forces mastery to 100% and labels an inferred fallback honestly', () => {
    const mastery = { ...rung, mode: 'cued', mastery: true, tempoPercent: 40 };
    render(<LearnLab {...base} rung={mastery} tempo={{ tempoMap: [{ onsetQuarter: 0, bpm: 90 }], tempoSource: 'inferred' }} />);
    expect(screen.getByText('100% of fallback tempo · 90 BPM')).toBeInTheDocument();
    expect(exercise.props.score.tempoPercent).toBe(100);
    expect(screen.queryByRole('button', { name: 'Decrease tempo' })).not.toBeInTheDocument();
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
