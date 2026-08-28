// Videos.policy.test.jsx — LecturePlayerRoute wires the per-user course policy:
// gate flag + auto-advance callback reach the player, auto-advance navigates to
// the next lecture, and the shared Player's racing end-clear (onBack fired in
// the same tick) must NOT yank the user back to the course menu.
import { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router-dom';
import { LecturePlayerRoute } from './Videos.jsx';

const state = {
  user: 'kckern',
  speakerConnected: true,
  config: {
    videos: {
      engagement_timeout_seconds: 90,
      user_policies: { kckern: { engagement_gate: false, auto_advance: true } },
    },
  },
  playable: {
    items: [
      { plex: '100', label: 'One' },
      { plex: '101', label: 'Two' },
    ],
    info: { title: 'Test Course' },
    isSequential: true,
  },
};

vi.mock('../../PianoConfig.jsx', () => ({ usePianoKioskConfig: () => ({ config: state.config }) }));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: state.user }) }));
vi.mock('./usePianoCoursePlayable.js', () => ({ usePianoCoursePlayable: () => state.playable }));
vi.mock('../../usePianoPlayback.js', () => ({ usePianoPlayback: () => ({ playing: false }) }));
vi.mock('../../usePianoScreensaverHooks.js', () => ({ useKeepScreenAwake: () => {} }));
vi.mock('../../PianoMidiContext.jsx', () => ({ usePianoMidi: () => ({ speakerConnected: state.speakerConnected }) }));

/** The pending-checkpoint record the route writes before it hands a child over. */
const remembered = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('../Exercises/pianoLearningApi.js', () => ({
  pianoLearningApi: { rememberCheckpoint: (...args) => remembered(...args) },
}));

// Module-level mount counter — every per-lecture piece of state this route
// feeds into the REAL PianoVideoPlayer (usePianoWatchLog's effect chain,
// furthestWatched, engagedRef) was written under a remount-per-lecture
// invariant. A prop-update of the same instance instead of a fresh mount
// would let that state straddle lectures (see the "remount-per-lecture
// invariant" regression test below), so this counter's only job is to prove
// the route forces a real unmount+remount on every lecture change.
let mountCount = 0;

function StubPlayer({ lecture, onBack, engagementGateEnabled, onAutoAdvance }) {
  useEffect(() => { mountCount += 1; }, []);
  return (
    <div>
      <div data-testid="lecture">{lecture.label}</div>
      <div data-testid="gate-enabled">{String(engagementGateEnabled)}</div>
      <div data-testid="has-advance">{String(Boolean(onAutoAdvance))}</div>
      <button type="button" onClick={() => onAutoAdvance?.()}>advance</button>
      {/* Simulates the production race: media `ended` triggers our advance AND
          the shared Player's end-of-content clear (onBack) in the same tick. */}
      <button type="button" onClick={() => { onAutoAdvance?.(); onBack(); }}>ended-race</button>
      <button type="button" onClick={onBack}>back</button>
    </div>
  );
}

/** Where a checkpoint hands a child over. The query is the assertion. */
function RunProbe() {
  const [query] = useSearchParams();
  return <div data-testid="run" data-query={query.toString()} />;
}

const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/videos/:courseId" element={<div data-testid="course-detail" />} />
      <Route path="/videos/:courseId/:lectureId" element={<LecturePlayerRoute PlayerComponent={StubPlayer} />} />
      <Route path="/exercises/run/*" element={<RunProbe />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  state.user = 'kckern';
  state.speakerConnected = true;
  mountCount = 0;
  delete state.playable.items[0].piano;
  delete state.playable.items[0].checkpointStatus;
  remembered.mockClear();
});

describe('LecturePlayerRoute — per-user policy wiring', () => {
  it('kckern gets gate disabled and an auto-advance callback', () => {
    renderAt('/videos/c1/plex:100');
    expect(screen.getByTestId('gate-enabled').textContent).toBe('false');
    expect(screen.getByTestId('has-advance').textContent).toBe('true');
  });

  it('a default user gets the gate and no auto-advance', () => {
    state.user = 'learner3';
    renderAt('/videos/c1/plex:100');
    expect(screen.getByTestId('gate-enabled').textContent).toBe('true');
    expect(screen.getByTestId('has-advance').textContent).toBe('false');
  });

  it('auto-advance navigates to the next lecture', () => {
    renderAt('/videos/c1/plex:100');
    fireEvent.click(screen.getByText('advance'));
    expect(screen.getByTestId('lecture').textContent).toBe('Two');
  });

  it('the Player’s racing end-clear cannot yank the user back during an auto-advance', () => {
    renderAt('/videos/c1/plex:100');
    fireEvent.click(screen.getByText('ended-race'));
    expect(screen.queryByTestId('course-detail')).toBe(null);
    expect(screen.getByTestId('lecture').textContent).toBe('Two');
  });

  it('on the LAST lecture, auto-advance falls back to the course menu', () => {
    renderAt('/videos/c1/plex:101');
    fireEvent.click(screen.getByText('advance'));
    expect(screen.getByTestId('course-detail')).toBeTruthy();
  });

  it('a plain back tap still leaves normally', () => {
    renderAt('/videos/c1/plex:100');
    fireEvent.click(screen.getByText('back'));
    expect(screen.getByTestId('course-detail')).toBeTruthy();
  });

  it('navigates back immediately when speakerConnected is false', () => {
    state.speakerConnected = false;
    renderAt('/videos/c1/plex:100');
    expect(screen.getByTestId('course-detail')).toBeTruthy();
    expect(screen.queryByTestId('lecture')).toBeNull();
  });

  /**
   * The PRIMARY checkpoint door: a child stopped mid-lesson by an exercise.
   *
   * `checkpointPending` alone turns `onAutoAdvance` on (a course with no
   * auto-advance policy still stops here), and the end of the lecture hands the
   * child to the exercise run route rather than to the next lecture. The query
   * it is handed over with is the whole contract — the run route reads its
   * requirement, its way back, and the LESSON'S NAME out of it, and the last of
   * those is what stops the exercise saying "Pass challenge" over a bank title
   * to a child who has no idea why it appeared (bug report C1).
   */
  it('a pending checkpoint sends the child to the exercise run, naming the lesson it interrupted', async () => {
    const checkpoint = { exercise_id: 'scales/c-major@test', mode: 'free', passScore: 0.8 };
    state.playable.items[0].piano = { checkpoint };
    renderAt('/videos/c1/plex:100');
    // The gate opens on the checkpoint alone — this user's policy happens to
    // allow auto-advance too, so assert the branch, not the policy.
    expect(screen.getByTestId('has-advance').textContent).toBe('true');

    fireEvent.click(screen.getByText('advance'));

    const query = new URLSearchParams((await screen.findByTestId('run')).dataset.query);
    expect(query.get('intent')).toBe('challenge');
    expect(JSON.parse(query.get('requirement'))).toEqual(checkpoint);
    expect(query.get('return')).toBe('/videos/c1/plex%3A101');
    // The lesson's own name, which the run route has nothing else to get: a
    // checkpoint is not a program step, so nothing downstream can fetch it.
    expect(query.get('label')).toBe('One');
    // …and it is the SAME name written to the pending record, which is where
    // the resume path (the exercises dashboard's Continue) reads its label —
    // so both doors into this screen name the lesson identically.
    await waitFor(() => expect(remembered).toHaveBeenCalledTimes(1));
    expect(remembered.mock.calls[0][2]).toMatchObject({ title: 'One', requirement: checkpoint });
  });

  it('a checkpoint already passed is not a checkpoint: the lecture advances as usual', async () => {
    state.playable.items[0].piano = { checkpoint: { exercise_id: 'scales/c-major@test' } };
    state.playable.items[0].checkpointStatus = { passed: true };
    renderAt('/videos/c1/plex:100');

    fireEvent.click(screen.getByText('advance'));

    expect(screen.getByTestId('lecture').textContent).toBe('Two');
    expect(screen.queryByTestId('run')).toBeNull();
    expect(remembered).not.toHaveBeenCalled();
  });

  it('auto-advance remounts the player (remount-per-lecture invariant — watch-log/furthestWatched/engagedRef must never straddle lectures)', () => {
    renderAt('/videos/c1/plex:100');
    expect(mountCount).toBe(1);
    fireEvent.click(screen.getByText('advance'));
    expect(screen.getByTestId('lecture').textContent).toBe('Two');
    expect(mountCount).toBe(2);
  });
});
