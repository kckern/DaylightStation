// A learner who still owes today's lesson has ONE launcher — the lesson card on
// the menu. The grid is where the 2026-09-01 escape happened (the mode crumb in
// PianoChrome navigates to `${basePath}/videos`, i.e. straight to this route, so
// from the assigned course one tap reached every course and a lesson from the
// wrong one).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CourseGridRoute } from './Videos.jsx';
import { PENDING_CAPTION } from '../../usePianoLessonGate.js';

const state = { gate: { status: 'ready', pending: false, gated: false, course: null }, user: 'user_5' };
const info = vi.hoisted(() => vi.fn());
vi.mock('../../PianoConfig.jsx', () => ({ usePianoKioskConfig: () => ({ basePath: '/piano', config: { videos: {} } }) }));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: state.user }) }));
vi.mock('../../usePianoLessonGate.js', async () => ({
  ...(await vi.importActual('../../usePianoLessonGate.js')),
  default: () => state.gate,
}));
vi.mock('./CourseGrid.jsx', () => ({ default: () => <div data-testid="course-grid" /> }));
vi.mock('../../../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info, debug() {}, warn() {}, error() {} }) }),
}));

const renderAt = () => render(
  <MemoryRouter initialEntries={['/piano/videos']}>
    <Routes>
      <Route path="/piano" element={<div data-testid="menu" />} />
      <Route path="/piano/videos" element={<CourseGridRoute groups={[]} />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  state.gate = { status: 'ready', pending: false, gated: false, course: null };
  state.user = 'user_5';
  info.mockClear();
});

describe('CourseGridRoute under the lesson gate', () => {
  it('renders the grid when not gated', () => {
    renderAt();
    expect(screen.getByTestId('course-grid')).toBeTruthy();
  });

  it('sends a gated learner back to the menu instead of the grid', () => {
    state.gate = { status: 'ready', pending: false, gated: true, course: { id: 'plex:695598' } };
    renderAt();
    expect(screen.queryByTestId('course-grid')).toBeNull();
    expect(screen.getByTestId('menu')).toBeTruthy();
  });

  it('logs the redirect with the learner and the owed course', () => {
    state.gate = { status: 'ready', pending: false, gated: true, course: { id: 'plex:695598' } };
    renderAt();
    expect(info).toHaveBeenCalledWith('piano.videos.grid-redirected', {
      learnerId: 'user_5', courseId: 'plex:695598',
    });
  });

  it('shows nothing (not the grid) while a named learner\'s verdict is loading', () => {
    state.gate = { status: 'loading', pending: true, gated: false, course: null };
    renderAt();
    expect(screen.queryByTestId('course-grid')).toBeNull();
    expect(screen.queryByTestId('menu')).toBeNull();
  });

  // A blank pane on a wall tablet reads as a crash, and the measured cold read
  // is 11.1s. The menu's own pending state says the same thing in the same
  // words (PianoMenu's `piano-home__pending` caption), so the grid does too
  // rather than going dark.
  it('says why it is waiting instead of rendering a blank pane', () => {
    state.gate = { status: 'loading', pending: true, gated: false, course: null };
    renderAt();
    expect(screen.getByRole('status').textContent).toBe(PENDING_CAPTION);
  });

  // `pending: false` here is not a convenience: it is the hook's guest rule
  // (verified in usePianoLessonGate.test.js), which this screen no longer
  // re-derives. A guest is never waiting for an assignment they cannot have.
  it('a guest always gets the grid', () => {
    state.user = 'guest';
    state.gate = { status: 'loading', pending: false, gated: false, course: null };
    renderAt();
    expect(screen.getByTestId('course-grid')).toBeTruthy();
  });

  // The hook fails open on purpose: a School-less install, a failed read and a
  // timed-out read all report `gated: false`, and none of them may cost a child
  // the course wall.
  it.each(['error', 'timeout', 'ready'])('opens the grid on a %s verdict that is not gated', (status) => {
    state.gate = { status, pending: false, gated: false, course: null };
    renderAt();
    expect(screen.getByTestId('course-grid')).toBeTruthy();
  });
});
