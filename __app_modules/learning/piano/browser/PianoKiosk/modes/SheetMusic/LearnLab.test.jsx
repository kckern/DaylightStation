import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LearnLab, { learnPracticeRequirement } from './LearnLab.jsx';
import KeyboardOnlyContext from './office/KeyboardOnlyContext.js';
import { createClickScheduler } from './clickScheduler.js';
import { useMetronomeClick } from './useMetronomeClick.js';
import { PianoFullscreenProvider, usePianoFullscreen } from '../../PianoFullscreenContext.jsx';

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
// The run reports its phase to the lab (ExerciseRun `onPhase`); the mock run never does on its own.
const phase = (value) => act(() => exercise.props.onPhase(value));
const openVolume = () => fireEvent.click(screen.getByRole('button', { name: /^Click volume/ }));
/** The speed is one header button; its stops live in a sheet (2026-11-24). */
const openSpeed = () => fireEvent.click(screen.getByRole('button', { name: /^Speed/ }));
const chooseSpeed = (name) => { openSpeed(); fireEvent.click(screen.getByRole('button', { name })); };
const base = { score: { id: 'score', musicXml: '<score />' }, revision: 'rev', segment, rung, onRecord: vi.fn(), onClose: vi.fn() };

describe('LearnLab', () => {
  beforeEach(() => { localStorage.clear(); log.info.mockClear(); });
  afterEach(() => vi.useRealTimers());

  // Two rails (2026-11-24): the status line replaces the app's top bar while a Learn drill is open.
  it('an uncoached Learn drill takes the kiosk full screen while open, so the app bar steps aside, and gives it back on leaving', () => {
    const memory = new Map();
    const store = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) };
    const seen = {};
    const Probe = () => { Object.assign(seen, usePianoFullscreen()); return null; };
    const { rerender } = render(<PianoFullscreenProvider storage={store}><Probe /><LearnLab {...base} /></PianoFullscreenProvider>);
    // The app bar (PianoChrome) is drawn only when not full screen; the drill hosts no toggle, so none floats either.
    expect(seen).toMatchObject({ fullscreen: true, hosted: true });
    rerender(<PianoFullscreenProvider storage={store}><Probe /></PianoFullscreenProvider>);
    expect(seen).toMatchObject({ fullscreen: false, hosted: false });
    // The kiosk's own remembered choice was never touched.
    expect(memory.size).toBe(0);
  });

  it('draws the keyboard row only for a learner whose config asks for key hints (always or after-wrong), never by default', () => {
    const { rerender } = render(<LearnLab {...base} />);
    expect(exercise.props.keyboard).toBe(false);
    rerender(<LearnLab {...base} assist={{ keyboardHints: 'always' }} />);
    expect(exercise.props.keyboard).toBe(true);
    rerender(<LearnLab {...base} assist={{ keyboardHints: 'after-wrong' }} />);
    expect(exercise.props.keyboard).toBe(true);
    rerender(<LearnLab {...base} assist={{ keyboardHints: 'never' }} />);
    expect(exercise.props.keyboard).toBe(false);
  });

  it('a save problem is said in the prompt slot, so the status line keeps its height and its heading', () => {
    render(<LearnLab {...base} notice={<div className="piano-learn-coach__save" role="status">Progress not saved</div>} />);
    expect(document.querySelector('.piano-learn-lab__prompt .piano-learn-coach__save')).not.toBeNull();
    // Only the cue is announced; the prompt's buttons are not a live region.
    expect(document.querySelector('.piano-learn-lab__prompt').getAttribute('aria-live')).toBeNull();
    expect(document.querySelector('.piano-learn-lab__cue').getAttribute('aria-live')).toBe('polite');
  });

  it('after a missed take the tablet keeps Listen beside the result\'s actions', () => {
    render(<LearnLab {...base} coachingTask={{ key: 'task' }} onOutcome={vi.fn()} onListen={vi.fn()} resultActions={<button type="button">Try again</button>} />);
    phase('done');
    expect(screen.getByRole('button', { name: 'Listen' })).toBeInTheDocument();
  });

  it('the status line says what to do and which bars on one line, with the player; no set or rep count', () => {
    render(<LearnLab {...base} player={{ id: 'learner4', name: 'Learner Four' }} />);
    const status = document.querySelector('.piano-learn-lab__toolbar');
    expect(status.querySelector('.piano-learn-lab__heading').textContent).toBe('Right handBars 1–4');
    expect(status.querySelector('.piano-learn-lab__avatar')).not.toBeNull();
    expect(status.textContent).not.toMatch(/Set \d+ of|Rep \d+ of/);
    // The run draws into the lab's two rails.
    expect(document.querySelector('.piano-learn-lab__rail .piano-learn-lab__rail-middle')).not.toBeNull();
    expect(exercise.props.slots).toEqual({ prompt: expect.any(HTMLElement), rail: expect.any(HTMLElement) });
  });

  it('logs actual preference transitions once and carries semantic selections into the run', () => {
    const timed = { ...rung, mode: 'cued', tempoPercent: 60 };
    const props = { ...base, rung: timed };
    const { rerender } = render(<LearnLab {...props} />);
    expect(exercise.props.traceContext).toMatchObject({ tempoStage: 'steady', clickLevel: 'loud' });
    openVolume(); fireEvent.click(screen.getByRole('button', { name: 'Soft' }));
    openVolume(); fireEvent.click(screen.getByRole('button', { name: 'Soft' }));
    chooseSpeed('25%');
    chooseSpeed('25%');
    rerender(<LearnLab {...props} />);
    expect(exercise.props.traceContext).toMatchObject({ tempoStage: 'very-slow', tempoPercent: 25, clickLevel: 'soft' });
    expect(log.info.mock.calls.filter(([event]) => event.includes('changed'))).toEqual([
      ['piano.learn-click-level-changed', expect.objectContaining({ scoreId: 'score', passageId: 'm0-3', rungId: 'right', previousClickLevel: 'loud', clickLevel: 'soft', clickGain: 0.08 })],
      ['piano.learn-tempo-stage-changed', expect.objectContaining({ previousTempoStage: 'steady', tempoStage: 'very-slow', previousTempoPercent: 60, tempoPercent: 25 })],
    ]);
    expect(log.info).toHaveBeenCalledWith('piano.learn.tempo.choose', expect.objectContaining({ from: 60, to: 25, step: 'right' }));
  });

  it('defaults to Loud and persists a selected click level for the next lab visit', () => {
    const timed = { ...rung, mode: 'cued' };
    const { unmount } = render(<LearnLab {...base} rung={timed} />);
    // One button in the header; the four levels are in its sheet.
    expect(screen.getByRole('button', { name: 'Click volume: Loud' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Soft' })).toBeNull();
    openVolume();
    const levels = screen.getByRole('group', { name: 'Click volume levels' });
    expect([...levels.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'))).toEqual(['Soft', 'Medium', 'Loud', 'Max']);
    expect(screen.getByRole('button', { name: 'Loud' })).toHaveAttribute('aria-pressed', 'true');
    expect(exercise.props.clickGain).toBe(0.36);
    const originalRunScore = exercise.props.score;
    fireEvent.click(screen.getByRole('button', { name: 'Soft' }));
    expect(screen.queryByRole('group', { name: 'Click volume levels' })).toBeNull();
    expect(exercise.props.clickGain).toBe(0.08);
    expect(exercise.props.score).toBe(originalRunScore);
    expect(screen.getByRole('button', { name: 'Click volume: Soft' })).toBeInTheDocument();
    expect(localStorage.getItem('piano.learn.click-level')).toBe('soft');
    unmount();
    render(<LearnLab {...base} rung={timed} />);
    expect(screen.getByRole('button', { name: 'Click volume: Soft' })).toBeInTheDocument();
    expect(exercise.props.clickGain).toBe(0.08);
  });

  it('keeps loudness usable when browser storage access throws', () => {
    const getter = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('blocked'); });
    try {
      render(<LearnLab {...base} rung={{ ...rung, mode: 'cued' }} />);
      expect(screen.getByRole('button', { name: 'Click volume: Loud' })).toBeInTheDocument();
      openVolume(); fireEvent.click(screen.getByRole('button', { name: 'Max' }));
      expect(screen.getByRole('button', { name: 'Click volume: Max' })).toBeInTheDocument();
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
    // Which set and rep: the pills on the coach rail (the run's projection), not a line of words.
    expect(screen.queryByText(/Set 1 of 1/)).toBeNull();
    expect(exercise.props.drillProjection.steps).toHaveLength(1);
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

  it('offers what can be done now: Change practice before a take, Pause during it, Resume and Start over paused', () => {
    const onChangePractice = vi.fn();
    render(<LearnLab {...base} onChangePractice={onChangePractice} />);
    const firstKey = exercise.props.controlKey;
    // Before a take there is nothing to pause or start over.
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull();
    phase('running');
    expect(screen.queryByRole('button', { name: 'Change practice' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(exercise.props.paused).toBe(true);
    phase('paused');
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(exercise.props.persistInterrupted).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(exercise.props.controlKey).not.toBe(firstKey);
    phase('ready');
    // Which set and rep: the pills on the coach rail (the run's projection), not a line of words.
    expect(screen.queryByText(/Set 1 of 1/)).toBeNull();
    expect(exercise.props.drillProjection.steps).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Change practice' }));
    expect(onChangePractice).toHaveBeenCalledWith(expect.objectContaining({ parts: ['rh'], mode: 'free' }));
    expect(log.info).toHaveBeenCalledWith('piano.learn.control', expect.objectContaining({ action: 'pause', scoreId: 'score', revision: 'rev', passageId: 'm0-3', mode: 'free', parts: ['rh'], creditEligible: true, runId: expect.any(String) }));
    expect(log.info).toHaveBeenCalledWith('piano.learn.control', expect.objectContaining({ action: 'restart' }));
    expect(log.info).toHaveBeenCalledWith('piano.learn.control', expect.objectContaining({ action: 'change-practice' }));
    expect(JSON.stringify(log.info.mock.calls)).not.toMatch(/\"midi\"|rawMidi/i);
  });

  it('the hold mid-take pauses the take; Resume continues it without a new take', () => {
    // The office menu (KeyboardOnlyContext `menuOpen`) pauses a take under way: no credit, no failure.
    const office = (menuOpen) => ({ input: 'keyboard-only', canListen: false, menuOpen, publishStrip: () => {} });
    const onOutcome = vi.fn();
    const { rerender } = render(<KeyboardOnlyContext.Provider value={office(false)}><LearnLab {...base} onOutcome={onOutcome} /></KeyboardOnlyContext.Provider>);
    phase('running');
    const take = exercise.props.controlKey;
    rerender(<KeyboardOnlyContext.Provider value={office(true)}><LearnLab {...base} onOutcome={onOutcome} /></KeyboardOnlyContext.Provider>);
    expect(exercise.props.paused).toBe(true);
    phase('paused');
    rerender(<KeyboardOnlyContext.Provider value={office(false)}><LearnLab {...base} onOutcome={onOutcome} /></KeyboardOnlyContext.Provider>);
    expect(exercise.props.paused).toBe(false);
    expect(exercise.props.controlKey).toBe(take); // the same take continues
    expect(onOutcome).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('piano.learn.control', expect.objectContaining({ action: 'pause', by: 'office-menu' }));
    expect(log.info).toHaveBeenCalledWith('piano.learn.control', expect.objectContaining({ action: 'resume', by: 'office-menu' }));
  });

  it('the hold pauses a take while it counts; let go early and the same take carries on', () => {
    const office = (menuHolding) => ({ input: 'keyboard-only', canListen: false, menuOpen: false, menuHolding, publishStrip: () => {} });
    const { rerender } = render(<KeyboardOnlyContext.Provider value={office(false)}><LearnLab {...base} /></KeyboardOnlyContext.Provider>);
    phase('running');
    const take = exercise.props.controlKey;
    rerender(<KeyboardOnlyContext.Provider value={office(true)}><LearnLab {...base} /></KeyboardOnlyContext.Provider>);
    expect(exercise.props.paused).toBe(true);
    rerender(<KeyboardOnlyContext.Provider value={office(false)}><LearnLab {...base} /></KeyboardOnlyContext.Provider>);
    expect(exercise.props.paused).toBe(false);
    expect(exercise.props.controlKey).toBe(take);
  });

  it('a take the menu paused and then left is logged as abandoned, and the run says the hold opens the menu', () => {
    const office = { input: 'keyboard-only', canListen: false, menuOpen: false, publishStrip: () => {} };
    const { rerender, unmount } = render(<KeyboardOnlyContext.Provider value={office}><LearnLab {...base} /></KeyboardOnlyContext.Provider>);
    expect(exercise.props.exitHint).toBe('Hold the lowest and highest keys for the menu.');
    phase('running');
    rerender(<KeyboardOnlyContext.Provider value={{ ...office, menuOpen: true }}><LearnLab {...base} /></KeyboardOnlyContext.Provider>);
    unmount();
    expect(log.info).toHaveBeenCalledWith('piano.learn.take-abandoned', expect.objectContaining({ reason: 'office-menu', creditOutcome: 'none' }));
  });

  it('the office menu opened between takes pauses nothing', () => {
    const office = (menuOpen) => ({ input: 'keyboard-only', canListen: false, menuOpen, publishStrip: () => {} });
    const { rerender } = render(<KeyboardOnlyContext.Provider value={office(false)}><LearnLab {...base} /></KeyboardOnlyContext.Provider>);
    rerender(<KeyboardOnlyContext.Provider value={office(true)}><LearnLab {...base} /></KeyboardOnlyContext.Provider>);
    expect(exercise.props.paused).toBe(false);
  });

  it('speed and volume are absent during a take and Listen, and their slot keeps its place', () => {
    render(<LearnLab {...base} rung={{ ...rung, mode: 'cued', tempoPercent: 60 }} onListen={vi.fn()} />);
    const slot = () => document.querySelector('.piano-learn-lab__settings');
    expect(screen.getByRole('button', { name: /^Speed/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Click volume/ })).toBeInTheDocument();
    for (const value of ['countdown', 'running']) {
      phase(value);
      expect(slot()).not.toBeNull();
      expect(screen.queryByRole('button', { name: /^Speed/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Click volume/ })).toBeNull();
    }
    phase('ready');
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    expect(screen.queryByRole('button', { name: /^Speed/ })).toBeNull();
    expect(slot()).not.toBeNull();
  });

  it('the speed sheet offers each stop as a button: no slider, no slower or faster', () => {
    render(<LearnLab {...base} rung={{ ...rung, mode: 'cued', tempoPercent: 60 }} tempo={{ tempoMap: [{ onsetQuarter: 0, bpm: 120 }], tempoSource: 'musicxml' }} />);
    expect(screen.getByRole('button', { name: /^Speed/ })).toHaveTextContent('60%');
    openSpeed();
    const sheet = screen.getByRole('group', { name: 'Tempo' });
    expect([...sheet.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(expect.arrayContaining(['25%', '40%', '60%', '100%']));
    expect(screen.queryByRole('button', { name: 'Faster' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Slower' })).toBeNull();
    expect(sheet.querySelector('[class*="track"], [class*="rail"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '25%' }));
    expect(exercise.props.score.tempoPercent).toBe(25);
    expect(screen.queryByRole('group', { name: 'Tempo' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Speed/ })).toHaveTextContent('25%');
  });

  it('the header says how to start, only while ready', () => {
    render(<LearnLab {...base} rung={{ ...rung, mode: 'cued', tempoPercent: 60 }} />);
    expect(screen.getByText('Press a key to start')).toBeInTheDocument();
    phase('countdown');
    expect(screen.queryByText('Press a key to start')).toBeNull();
    phase('done');
    expect(screen.queryByText('Press a key to start')).toBeNull();
  });

  it('hides the start prompt while a missed cue holds for its restart, keeping its slot', () => {
    render(<LearnLab {...base} rung={{ ...rung, mode: 'cued', tempoPercent: 60 }} />);
    phase('cue-restart');
    expect(screen.queryByText('Press a key to start')).toBeNull();
    expect(screen.queryByText('or a pedal')).toBeNull();
    expect(document.querySelector('.piano-learn-lab__prompt')).not.toBeNull();
    // A take is under way: nothing to change mid-take, but it can be paused.
    expect(screen.queryByRole('button', { name: 'Listen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('Back names its destination, the score', () => {
    const onClose = vi.fn();
    render(<LearnLab {...base} coachingTask={{ key: 'task' }} onClose={onClose} onOutcome={vi.fn()} />);
    // A 48px mark at the far right of the status line; its name says where it goes.
    const back = screen.getByRole('button', { name: 'Back to score' });
    expect(back).toHaveClass('piano-learn-lab__back');
    expect(back.closest('.piano-learn-lab__toolbar').lastElementChild).toBe(back);
    fireEvent.click(back);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the step instruction is the title and the bars its subtitle', () => {
    render(<LearnLab {...base} coachingTask={{ key: 'task' }} onOutcome={vi.fn()} />);
    const heading = document.querySelector('.piano-learn-lab__heading');
    expect(heading.querySelector('strong')).toHaveTextContent('Right hand');
    expect(heading.querySelector('span')).toHaveTextContent('Bars 1–4');
  });

  it('allows both metronome modes to change tempo by restarting only the current take', () => {
    render(<LearnLab {...base} rung={{ ...rung, mode: 'metronome', tempoPercent: 60 }} tempo={{ minimumPercent: 15, maximumPercent: 100, tempoMap: [{ onsetQuarter: 0, bpm: 100 }] }} />);
    const firstKey = exercise.props.controlKey;
    chooseSpeed('15%');
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
    // The rep banked on the pills (the run's projection): the second rep is the current one.
    expect(exercise.props.drillProjection.steps[0]).toMatchObject({ pass_count: 1, state: 'current' });
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

  it('a take that starts with the speed sheet open takes the sheet away, and Escape still leaves', () => {
    const onClose = vi.fn();
    render(<LearnLab {...base} onClose={onClose} rung={{ ...rung, mode: 'cued', tempoPercent: 60 }} />);
    openSpeed();
    phase('countdown');
    expect(screen.queryByRole('dialog', { name: 'Speed' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('advances through configured set percentages and carries the full score tempo source', () => {
    const timed = { ...rung, mode: 'cued', sets: 3, reps: 1, passCount: 1, required: 3, tempoPercent: 60, tempoPercents: [60, 75, 90] };
    const onRecord = vi.fn(() => ({}));
    render(<LearnLab {...base} onRecord={onRecord} rung={timed} tempo={{ tempoMap: [{ onsetQuarter: 0, bpm: 100 }, { onsetQuarter: 8, bpm: 80 }], tempoSource: 'musicxml', minimumPercent: 40, maximumPercent: 100 }} />);
    openSpeed();
    expect(screen.getByRole('button', { name: '80%' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('80 bpm')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(exercise.props.score.tempoPercent).toBe(80);
    expect(exercise.props.traceContext.tempoSource).toBe('musicxml');
    fireEvent.click(screen.getByRole('button', { name: 'Finish take' }));
    expect(onRecord).toHaveBeenCalledTimes(1);
  });

  it('keeps learner controls within configured bounds', () => {
    const timed = { ...rung, mode: 'cued', tempoPercent: 60 };
    render(<LearnLab {...base} rung={timed} tempo={{ tempoMap: [{ onsetQuarter: 0, bpm: 100 }], tempoSource: 'musicxml', minimumPercent: 55, maximumPercent: 65 }} />);
    openSpeed();
    expect(screen.getByRole('button', { name: '60%' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '25%' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '100%' })).not.toBeInTheDocument();
    expect(exercise.props.score.tempoPercent).toBe(60);
  });

  it('forces mastery to 100% and offers no tempo track or tempo-source words', () => {
    const mastery = { ...rung, mode: 'cued', mastery: true, tempoPercent: 40 };
    render(<LearnLab {...base} rung={mastery} tempo={{ tempoMap: [{ onsetQuarter: 0, bpm: 90 }], tempoSource: 'inferred' }} />);
    expect(screen.queryByText('Fallback tempo')).toBeNull();
    expect(exercise.props.score.tempoPercent).toBe(100);
    expect(screen.queryByRole('button', { name: /^Speed/ })).not.toBeInTheDocument();
  });

  it('directly chooses 25% and scales the original score contract to it', () => {
    render(<LearnLab {...base} rung={{ ...rung, mode: 'cued', tempoPercent: 60 }} tempo={{ tempoMap: [{ onsetQuarter: 0, bpm: 120 }], tempoSource: 'musicxml' }} />);
    openSpeed();
    expect(screen.getByText('72 bpm')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '25%' }));
    expect(exercise.props.score).toMatchObject({ tempoPercent: 25, musicXml: '<score />' });
    openSpeed();
    expect(screen.getByText('30 bpm')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '40%' }));
    expect(exercise.props.score.tempoPercent).toBe(40);
  });

  it('dismisses the click-volume sheet with Escape while leaving the lab open', () => {
    const onClose = vi.fn();
    render(<LearnLab {...base} onClose={onClose} rung={{ ...rung, mode: 'cued', tempoPercent: 60 }} />);
    openVolume();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Click volume levels' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clamps the named selection into a narrow interval excluding standard stages', () => {
    render(<LearnLab {...base} rung={{ ...rung, mode: 'cued', tempoPercent: 100 }} tempo={{ minimumPercent: 61, maximumPercent: 65, tempoMap: [{ onsetQuarter: 0, bpm: 100 }] }} />);
    expect(exercise.props.score.tempoPercent).toBe(61);
    openSpeed();
    expect(screen.getByRole('button', { name: '61%' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps Test Out at Full speed despite bounded practice tempo', () => {
    render(<LearnLab {...base} rung={{ ...rung, mode: 'cued', completion: 'tested-out', tempoPercent: 25 }} tempo={{ minimumPercent: 25, maximumPercent: 60 }} />);
    expect(exercise.props.score.tempoPercent).toBe(100);
    expect(screen.queryByRole('button', { name: /^Speed/ })).not.toBeInTheDocument();
  });

  it('offers no tempo track when adjustments are disabled', () => {
    render(<LearnLab {...base} rung={{ ...rung, mode: 'cued', tempoPercent: 60 }} tempo={{ adjustable: false }} />);
    expect(screen.queryByRole('button', { name: /^Speed/ })).not.toBeInTheDocument();
    expect(exercise.props.score.tempoPercent).toBe(60);
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
    expect(onOutcome).toHaveBeenCalledExactlyOnceWith(result, { placementShare: null, tempoPercent: 100 });
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
    // Listening plays inside the drill: Pause and Stop, and the run plays it.
    expect(exercise.props.demonstration).toMatchObject({ playing: true });
    expect(screen.queryByRole('button', { name: 'Listen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(exercise.props.demonstration).toMatchObject({ playing: false });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(exercise.props.demonstration).toMatchObject({ playing: true });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(exercise.props.demonstration).toBeNull();
    expect(screen.getByRole('button', { name: 'Listen' })).toBeInTheDocument();
    // Played to its end, it hands the drill back ready.
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    act(() => exercise.props.demonstration.onDone());
    expect(exercise.props.demonstration).toBeNull();
    expect(log.info).toHaveBeenCalledWith('piano.learn.control', expect.objectContaining({ action: 'listen' }));
  });

  it('the uncoached lab: Back names its passage, the status line its bars, the rail its sets; no Listen', () => {
    render(<LearnLab {...base} />);
    expect(screen.getByRole('button', { name: 'Back to Segment 1' })).toBeInTheDocument();
    expect(document.querySelector('.piano-learn-lab__heading span')).toHaveTextContent('Bars 1–4');
    expect(screen.queryByText(/Set 1 of 1/)).toBeNull();
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

  it('grades the coached take at the tempo it is played at, and reports the share it used', () => {
    const onOutcome = vi.fn();
    const timed = { ...base.rung, mode: 'cued', tempoPercent: 60 };
    const view = render(<LearnLab {...base} rung={timed} coachingTask={{ key: 'task', tempoPercent: 100 }} onOutcome={onOutcome} />);
    expect(exercise.props.practiceRequirement.policy).toBeUndefined();
    const miss = { assessmentId: 'one', status: 'completed', verdict: { passed: false } };
    act(() => { exercise.props.onFailed(miss); });
    expect(onOutcome).toHaveBeenLastCalledWith(miss, { placementShare: null, tempoPercent: 100 });
    view.unmount();
    render(<LearnLab {...base} rung={{ ...timed, tempoPercent: 100 }} coachingTask={{ key: 'task', tempoPercent: 75 }} onOutcome={onOutcome} />);
    expect(exercise.props.practiceRequirement.policy).toEqual({ placementFullCreditShare: 0.6 });
    act(() => { exercise.props.onFailed({ ...miss, assessmentId: 'two' }); });
    expect(onOutcome).toHaveBeenLastCalledWith({ ...miss, assessmentId: 'two' }, { placementShare: 0.6, tempoPercent: 75 });
  });

  it('records the placement share on an uncoached take\'s terminal log', () => {
    render(<LearnLab {...base} rung={{ ...base.rung, mode: 'cued', tempoPercent: 60, reps: 3, required: 6 }} />);
    act(() => { exercise.props.onFailed({ status: 'completed', verdict: { passed: false }, entryShift: { beats: 1, matched: 4, possible: 4 } }); });
    expect(log.info).toHaveBeenCalledWith('piano.learn.terminal', expect.objectContaining({ status: 'failed', tempoPercent: 60, placementShare: 0.6, entryShiftBeats: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish take' }));
    expect(log.info).toHaveBeenCalledWith('piano.learn.terminal', expect.objectContaining({ status: 'passed', placementShare: 0.6 }));
  });

  it('keeps a coached toolbar to what a child acts on', () => {
    render(<LearnLab {...base} rung={{ ...base.rung, mode: 'cued', tempoPercent: 60 }} coachingTask={{ key: 'task', tempoPercent: 60 }} tempo={{ tempoMap: [{ bpm: 100 }], tempoSource: 'musicxml' }} onOutcome={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Change practice' })).toBeNull();
    expect(screen.queryByText(/Score tempo|Fallback tempo|BPM/)).toBeNull();
  });

  it('plays, grades and reports a coached take at the tempo the child chose on the track', () => {
    const onOutcome = vi.fn(); const onChange = vi.fn();
    const choice = { stops: [50, 60, 75, 90, 100], ladder: [50, 75, 100], earned: [], stepPercent: 50, value: 75, onChange };
    render(<LearnLab {...base} rung={{ ...base.rung, mode: 'cued', tempoPercent: 50 }} coachingTask={{ key: 'task', tempoPercent: 50 }} tempoChoice={choice}
      tempo={{ tempoMap: [{ bpm: 100 }] }} onOutcome={onOutcome} />);
    expect(exercise.props.score.tempoPercent).toBe(75);
    openSpeed();
    expect(screen.getByRole('button', { name: '75%' })).toHaveAttribute('aria-pressed', 'true');
    // The stops a pass would fill are lit; the step's own is not.
    expect(screen.getByRole('button', { name: '60%' })).toHaveAttribute('data-lit', 'true');
    expect(screen.getByRole('button', { name: '50%' })).not.toHaveAttribute('data-lit');
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    expect(onChange).toHaveBeenCalledWith(100);
    act(() => { exercise.props.onFailed({ assessmentId: 'one', status: 'completed', verdict: { passed: false } }); });
    expect(onOutcome).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ tempoPercent: 75 }));
  });

  it('credits a plain rung played at or above the stage it was set', () => {
    const onRecord = vi.fn(() => ({}));
    render(<LearnLab {...base} rung={{ ...rung, mode: 'cued', tempoPercent: 60, reps: 2, required: 2 }} onRecord={onRecord} />);
    chooseSpeed('80%');
    fireEvent.click(screen.getByRole('button', { name: 'Finish take' }));
    expect(onRecord).toHaveBeenCalledTimes(1);
    chooseSpeed('40%');
    fireEvent.click(screen.getByRole('button', { name: 'Finish take' }));
    expect(onRecord).toHaveBeenCalledTimes(1);
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
  it('follows the tempo the take is played at, not the one the rung was configured with', () => {
    // Configured below score tempo, played at it: the strict curve.
    expect(learnPracticeRequirement(rung({ tempoPercent: 60 }), 100).policy).toBeUndefined();
    // A rung that sets its tempo per set, played at 60%: the wider share.
    expect(learnPracticeRequirement(rung({ tempoPercent: undefined, tempoPercents: [50, 60, 75] }), 60).policy).toEqual({ placementFullCreditShare: 0.6 });
    // Any cued step below score tempo, whatever put it there.
    expect(learnPracticeRequirement(rung({ id: 'slower-beat', tempoPercent: 100 }), 90).policy).toEqual({ placementFullCreditShare: 0.6 });
  });
  it('keeps hands-together onsets alongside the wider share', () => {
    expect(learnPracticeRequirement(rung({ effectiveParts: ['rh', 'lh'] })).policy).toEqual({ requireConcurrentOnset: true, placementFullCreditShare: 0.6 });
    expect(learnPracticeRequirement(rung({ effectiveParts: ['rh', 'lh'], mode: 'free' })).policy).toEqual({ requireConcurrentOnset: true });
  });
});
