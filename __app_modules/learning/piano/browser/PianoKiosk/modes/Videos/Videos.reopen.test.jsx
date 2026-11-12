// Videos.reopen.test.jsx — reopening a lesson that owes a warm-up shows the
// reopen card: Warm up opens the drill, Watch again starts the video from 0.
import { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router-dom';
import { LecturePlayerRoute } from './Videos.jsx';
const api = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('../../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));
vi.mock('./LessonDrill.jsx', () => ({ default: (props) => (
  <div data-testid="lesson-drill">
    <button type="button" onClick={() => props.onRepPassed?.(1)}>rep</button>
    <button type="button" onClick={() => props.onLeave?.(1)}>leave-drill</button>
  </div>
) }));

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
  // eslint-disable-next-line no-unused-vars
  const resume = lecture.userPlayhead;
  useEffect(() => { mountCount += 1; }, []);
  return (
    <div>
      <div data-testid="lecture">{lecture.label}</div>
      <div data-testid="playhead">{String(lecture.userPlayhead)}</div>
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

const OWED = { outcome: 'drill-owed', drill: { reps: 2, sets: 1, roots: ['C'], spec: { kind: 'exercise' } } };

describe('LecturePlayerRoute — reopen card', () => {
  beforeEach(() => {
    state.user = 'test-learner';
    api.mockClear();
    Object.assign(state.playable.items[0], { userWatched: false, userPercent: 95, userPlayhead: 570, duration: 600, userCredit: OWED });
  });

  it('shows the reopen card with both choices and no score', () => {
    renderAt('/videos/c1/plex:100');
    expect(screen.getByText('Almost there')).toBeTruthy();
    expect(screen.getByText("This lesson doesn't count yet. Do a quick warm-up to count it, or watch it again and play along.")).toBeTruthy();
    expect(screen.queryByTestId('lecture')).toBe(null);
    expect(document.body.textContent).not.toMatch(/\/10|score/i);
  });

  it('Warm up opens the drill and each rep is posted with drillsPassed', async () => {
    renderAt('/videos/c1/plex:100');
    fireEvent.click(screen.getByText('Warm up'));
    expect(screen.getByTestId('lesson-drill')).toBeTruthy();
    fireEvent.click(screen.getByText('rep'));
    await waitFor(() => expect(api.mock.calls.some(([p]) => p === 'api/v1/play/log')).toBe(true));
    const [, body] = api.mock.calls.find(([p]) => p === 'api/v1/play/log');
    expect(body).toMatchObject({ assetId: 'plex:100', userId: 'test-learner', percent: 95, practice: { drillsPassed: 1 } });
  });

  it('Watch again starts the video from 0', () => {
    renderAt('/videos/c1/plex:100');
    fireEvent.click(screen.getByText('Watch again'));
    expect(screen.getByTestId('lecture').textContent).toBe('One');
    expect(screen.getByTestId('playhead').textContent).toBe('0');
  });

  it('a credited lesson opens straight into the player', () => {
    Object.assign(state.playable.items[0], { userCredit: { outcome: 'credited' }, userWatched: true });
    renderAt('/videos/c1/plex:100');
    expect(screen.getByTestId('lecture')).toBeTruthy();
  });
});
