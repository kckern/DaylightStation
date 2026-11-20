import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LearnLab, { learnPracticeRequirement } from './LearnLab.jsx';
import { createClickScheduler } from './clickScheduler.js';
import { useMetronomeClick } from './useMetronomeClick.js';

const exercise = vi.hoisted(() => ({ props: null }));
const log = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock('../../../../../../../frontend/src/lib/logging/Logger.js', () => ({ default: () => ({ child: () => log }) }));
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
  beforeEach(() => { localStorage.clear(); log.info.mockClear(); });
  afterEach(() => vi.useRealTimers());

  it('logs actual preference transitions once and carries semantic selections into the run', () => {
    const timed = { ...rung, mode: 'cued', tempoPercent: 60 };
    const props = { ...base, rung: timed };
    const { rerender } = render(<LearnLab {...props} />);
    expect(exercise.props.traceContext).toMatchObject({ tempoStage: 'steady', clickLevel: 'loud' });
    fireEvent.click(screen.getByRole('button', { name: 'Soft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Soft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose tempo: Steady' }));
    fireEvent.click(screen.getByRole('button', { name: /Very slow/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose tempo: Very slow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Very slow', exact: true }));
    rerender(<LearnLab {...props} />);
    expect(exercise.props.traceContext).toMatchObject({ tempoStage: 'very-slow', tempoPercent: 25, clickLevel: 'soft' });
    expect(log.info.mock.calls.filter(([event]) => event.includes('changed'))).toEqual([
      ['piano.learn-click-level-changed', expect.objectContaining({ scoreId: 'score', passageId: 'm0-3', rungId: 'right', previousClickLevel: 'loud', clickLevel: 'soft', clickGain: 0.08 })],
      ['piano.learn-tempo-stage-changed', expect.objectContaining({ previousTempoStage: 'steady', tempoStage: 'very-slow', previousTempoPercent: 60, tempoPercent: 25 })],
    ]);
  });

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
    expect(exercise.props).toMatchObject({ scoreCursorPolicy: 'always', scoreLayoutPolicy: 'whole-passage', keyboardHintPolicy: 'after-wrong', surface: 'learn-lab', hideHeading: true });
    expect(exercise.props.bare).toBeUndefined();
    expect(exercise.props.failurePresentation).toBe('local');
    expect(exercise.props.practiceRequirement.rubric.criteria).toEqual({ completeness: 1, cleanliness: 0.8 });
  });

  it('runs the Silver check without hints and with its stall', () => {
    render(<LearnLab {...base} coachingTask={{ assist: 'none', stallSeconds: 45, tempoPercent: null, parts: ['rh'] }} />);
    expect(exercise.props).toMatchObject({ keyboardHintPolicy: 'never', incompleteAfterMs: 45000 });
  });

  it('keeps ordinary coached practice hinted and without a stall', () => {
    render(<LearnLab {...base} coachingTask={{ tempoPercent: null, parts: ['rh'] }} />);
    expect(exercise.props.keyboardHintPolicy).toBe('after-wrong');
    expect(exercise.props.incompleteAfterMs).toBeNull();
  });

  it('keeps Pause, Start over, and Change practice visible and controls the current take only', () => {
    const onChangePractice = vi.fn();
    render(<LearnLab {...base} onChangePractice={onChangePractice} />);
    const firstKey = exercise.props.controlKey;
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(exercise.props.paused).toBe(true);
    expect(exercise.props.persistInterrupted).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(exercise.props.controlKey).not.toBe(firstKey);
    expect(screen.getByText('Set 1 of 1 · Rep 1 of 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change practice' }));
    expect(onChangePractice).toHaveBeenCalledWith(expect.objectContaining({ parts: ['rh'], mode: 'free' }));
    expect(log.info).toHaveBeenCalledWith('piano.learn.control', expect.objectContaining({ action: 'pause', scoreId: 'score', revision: 'rev', passageId: 'm0-3', mode: 'free', parts: ['rh'], creditEligible: true, runId: expect.any(String) }));
    expect(log.info).toHaveBeenCalledWith('piano.learn.control', expect.objectContaining({ action: 'restart' }));
    expect(log.info).toHaveBeenCalledWith('piano.learn.control', expect.objectContaining({ action: 'change-practice' }));
    expect(JSON.stringify(log.info.mock.calls)).not.toMatch(/\"midi\"|rawMidi/i);
  });

  it('allows both metronome modes to change tempo by restarting only the current take', () => {
    render(<LearnLab {...base} rung={{ ...rung, mode: 'metronome', tempoPercent: 60 }} tempo={{ minimumPercent: 15, maximumPercent: 100, tempoMap: [{ onsetQuarter: 0, bpm: 100 }] }} />);
    const firstKey = exercise.props.controlKey;
    fireEvent.click(screen.getByRole('button', { name: /Choose tempo: Steady/ }));
    fireEvent.click(screen.getByRole('button', { name: /Extra slow/ }));
    expect(exercise.props.controlKey).not.toBe(firstKey);
    expect(exercise.props.traceContext).toMatchObject({ tempoPercent: 15, tempoStage: 'extra-slow' });
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

  it('runs completed review drills from fresh temporary progress without banking them again', () => {
    const onFinished = vi.fn();
    const onRecord = vi.fn();
    const review = { ...rung, sets: 1, reps: 2, required: 2, passCount: 0, achievementPassCount: 2, achievementComplete: true };
    render(<LearnLab {...base} rung={review} launchSource="review" creditEligible={false} onRecord={onRecord} onFinished={onFinished} />);
    fireEvent.click(screen.getByRole('button', { name: 'Finish take' }));
    expect(onRecord).not.toHaveBeenCalled();
    expect(onFinished).not.toHaveBeenCalled();
    expect(screen.getByText('Set 1 of 1 · Rep 2 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finish take' }));
    expect(onFinished).toHaveBeenCalledWith(expect.objectContaining({ verdict: { passed: true } }));
  });

  it('banks an exact custom match against the unfinished ladder rung', () => {
    const onRecord = vi.fn(() => ({ rungComplete: false, passage: { complete: false } }));
    const creditRung = { ...rung, id: 'timed', mode: 'cued', tempoPercent: 60, required: 3 };
    render(<LearnLab {...base} rung={{ ...rung, id: 'custom', mode: 'cued', tempoPercent: 60 }} launchSource="custom" creditEligible creditRung={creditRung} onRecord={onRecord} onFinished={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Finish take' }));
    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ rungId: 'timed', requiredPasses: 3 }));
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
    const onRecord = vi.fn(() => ({}));
    render(<LearnLab {...base} onRecord={onRecord} rung={timed} tempo={{ tempoMap: [{ onsetQuarter: 0, bpm: 100 }, { onsetQuarter: 8, bpm: 80 }], tempoSource: 'musicxml', minimumPercent: 40, maximumPercent: 100 }} />);
    expect(screen.getByRole('button', { name: 'Choose tempo: Nearly there · 80 BPM' })).toBeInTheDocument();
    expect(exercise.props.score.tempoPercent).toBe(80);
    expect(exercise.props.traceContext.tempoSource).toBe('musicxml');
    fireEvent.click(screen.getByRole('button', { name: 'Finish take' }));
    expect(onRecord).toHaveBeenCalledTimes(1);
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
  it('reports exactly one coached take without legacy credit or automatic repetitions', () => {
    const onOutcome = vi.fn(); const onRecord = vi.fn();
    render(<LearnLab {...base} rung={{ ...rung, reps: 3, required: 6 }} coachingTask={{ key: 'task' }} onOutcome={onOutcome} onRecord={onRecord} />);
    expect(screen.queryByText(/Set 1 of/)).not.toBeInTheDocument();
    expect(exercise.props.persistAssessment).toBe(false);
    // The drill's own result panel shows a coached miss; the host adds its next moves to it.
    expect(exercise.props.failurePresentation).toBe('local');
    fireEvent.click(screen.getByRole('button', { name: 'Finish take' }));
    expect(onOutcome).toHaveBeenCalledTimes(1);
    expect(onRecord).not.toHaveBeenCalled();
    expect(screen.queryByText(/Rep 2/)).not.toBeInTheDocument();
  });

  it('hands a failed coached take to the host without counting it twice', () => {
    const onOutcome = vi.fn(); const onRecord = vi.fn();
    render(<LearnLab {...base} coachingTask={{ key: 'task' }} onOutcome={onOutcome} onRecord={onRecord} />);
    const result = { assessmentId: 'original', status: 'completed', verdict: { passed: false } };
    act(() => { exercise.props.onFailed(result); exercise.props.onFailed(result); });
    expect(onOutcome).toHaveBeenCalledExactlyOnceWith(result);
    expect(onRecord).not.toHaveBeenCalled();
  });

  it('gives a coached passage the drill chrome: bars only, its own sets, and Listen', () => {
    const onListen = vi.fn(); const onPickStep = vi.fn();
    const drill = { projection: { id: 'learn:m0-3', displaySingleStep: true, steps: [{ id: 'a' }, { id: 'b' }] }, stepId: 'b' };
    render(<LearnLab {...base} coachingTask={{ key: 'task' }} drill={drill} onListen={onListen} onPickStep={onPickStep}
      resultLabel="Almost on your own" resultActions={<button type="button">Practice bar 2</button>}
      notice={<strong>Progress not saved</strong>} extraControls={<button type="button">Come back to this later</button>} onOutcome={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Bars 1–4 · Right hand' })).toBeInTheDocument();
    expect(screen.queryByText('Segment 1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to score' })).toBeInTheDocument();
    expect(exercise.props).toMatchObject({ drillProjection: drill.projection, stepId: 'b', resultLabel: 'Almost on your own', onPickStep });
    expect(exercise.props.resultActions).toBeTruthy();
    expect(screen.getByText('Progress not saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Come back to this later' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    expect(onListen).toHaveBeenCalledTimes(1);
    expect(log.info.mock.calls.some(([event, data]) => event === 'piano.learn.take-abandoned' && data.reason === 'listen')).toBe(true);
  });

  it('keeps the uncoached lab as it was: segment name, set and rep line, no Listen', () => {
    render(<LearnLab {...base} />);
    expect(screen.getByText('Segment 1')).toBeInTheDocument();
    expect(screen.getByText(/Set 1 of 1/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Listen' })).not.toBeInTheDocument();
    expect(exercise.props.stepId).toBe('right:set-1');
  });

  it('reports each coached take once, and a take replayed from the piano is a new one', () => {
    const onOutcome = vi.fn(); const onStarted = vi.fn();
    render(<LearnLab {...base} coachingTask={{ key: 'task' }} onOutcome={onOutcome} onStarted={onStarted} />);
    const miss = { assessmentId: 'one', status: 'completed', verdict: { passed: false } };
    act(() => { exercise.props.onStarted(); exercise.props.onFailed(miss); exercise.props.onFailed(miss); });
    expect(onOutcome).toHaveBeenCalledTimes(1);
    act(() => { exercise.props.onStarted(); exercise.props.onFailed({ ...miss, assessmentId: 'two' }); });
    expect(onStarted).toHaveBeenCalledTimes(2);
    expect(onOutcome).toHaveBeenCalledTimes(2);
    expect(onOutcome.mock.calls[1][0].assessmentId).toBe('two');
  });

  it("shows the host's rep card, and its ceremony over the run", () => {
    vi.useFakeTimers();
    const onCardDone = vi.fn();
    const view = render(<LearnLab {...base} coachingTask={{ key: 'task' }} onOutcome={vi.fn()} onCardDone={onCardDone}
      card={{ id: 'take', copy: { eyebrow: 'Bar 2', headline: '100%', line: 'Next: On your own' } }} />);
    expect(screen.getByRole('status', { name: 'Bar 2. 100%. Next: On your own.' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2300));
    expect(onCardDone).toHaveBeenCalledTimes(1);
    view.rerender(<LearnLab {...base} coachingTask={{ key: 'task' }} onOutcome={vi.fn()} ceremony={<div data-testid="curtain" />} />);
    expect(screen.getByTestId('curtain').closest('.piano-learn-lab')).not.toBeNull();
    vi.useRealTimers();
  });

  it('keeps a coached toolbar to what a child acts on', () => {
    render(<LearnLab {...base} rung={{ ...base.rung, mode: 'cued', tempoPercent: 60 }} coachingTask={{ key: 'task', tempoPercent: 60 }} tempo={{ tempoMap: [{ bpm: 100 }], tempoSource: 'musicxml' }} onOutcome={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Change practice' })).toBeNull();
    expect(screen.queryByText(/Score tempo|Fallback tempo/)).toBeNull();
    expect(screen.getByText('60 BPM')).toBeInTheDocument();
  });

});

describe('learnPracticeRequirement', () => {
  const rung = (over) => ({ id: 'timed-60', mode: 'cued', tempoPercent: 60, effectiveParts: ['rh'], criteria: { completeness: 1, cleanliness: 0.8, placement: 0.8 }, ...over });
  it('widens full timing credit on the slowed timed steps only', () => {
    for (const percent of [50, 60, 75]) expect(learnPracticeRequirement(rung({ id: `timed-${percent}`, tempoPercent: percent })).policy).toEqual({ placementFullCreditShare: 0.6 });
    // The pass bar itself is unchanged.
    expect(learnPracticeRequirement(rung()).rubric.criteria.placement).toBe(0.8);
  });
  it('keeps score tempo, Gold, test-out and untimed steps on the strict curve', () => {
    for (const over of [{ id: 'mastery', tempoPercent: 100 }, { tempoPercent: 100 }, { mastery: true }, { id: 'test-out', tempoPercent: 100, completion: 'tested-out' }, { mode: 'free', tempoPercent: null }]) {
      expect(learnPracticeRequirement(rung(over)).policy?.placementFullCreditShare).toBeUndefined();
    }
  });
  it('keeps hands-together onsets alongside the wider share', () => {
    expect(learnPracticeRequirement(rung({ effectiveParts: ['rh', 'lh'] })).policy).toEqual({ requireConcurrentOnset: true, placementFullCreditShare: 0.6 });
    expect(learnPracticeRequirement(rung({ effectiveParts: ['rh', 'lh'], mode: 'free' })).policy).toEqual({ requireConcurrentOnset: true });
  });
});
