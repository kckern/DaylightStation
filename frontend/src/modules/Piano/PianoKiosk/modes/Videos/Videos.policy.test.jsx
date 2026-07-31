// Videos.policy.test.jsx — LecturePlayerRoute wires the per-user course policy:
// gate flag + auto-advance callback reach the player, auto-advance navigates to
// the next lecture, and the shared Player's racing end-clear (onBack fired in
// the same tick) must NOT yank the user back to the course menu.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { LecturePlayerRoute } from './Videos.jsx';

const state = {
  user: 'kckern',
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
vi.mock('../../PianoPlaybackContext.jsx', () => ({ usePianoPlayback: () => ({ playing: false }) }));
vi.mock('../../usePianoScreensaver.jsx', () => ({ useKeepScreenAwake: () => {} }));

function StubPlayer({ lecture, onBack, engagementGateEnabled, onAutoAdvance }) {
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

const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/videos/:courseId" element={<div data-testid="course-detail" />} />
      <Route path="/videos/:courseId/:lectureId" element={<LecturePlayerRoute PlayerComponent={StubPlayer} />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  state.user = 'kckern';
});

describe('LecturePlayerRoute — per-user policy wiring', () => {
  it('kckern gets gate disabled and an auto-advance callback', () => {
    renderAt('/videos/c1/plex:100');
    expect(screen.getByTestId('gate-enabled').textContent).toBe('false');
    expect(screen.getByTestId('has-advance').textContent).toBe('true');
  });

  it('a default user gets the gate and no auto-advance', () => {
    state.user = 'milo';
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
});
