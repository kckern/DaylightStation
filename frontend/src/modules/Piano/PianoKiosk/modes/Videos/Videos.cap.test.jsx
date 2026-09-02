/**
 * The daily video cap, at the Videos mode's three doors.
 *
 * The lesson gate closes the GRID only, and says so in its own header: the
 * checkpoint `return` param, a DoNow push, history, and a reload all reach
 * `CourseDetailRoute` / `LecturePlayerRoute` with a `:courseId` from the URL and
 * no gate read. Those are documented as residual escapes for `gated`, where the
 * cost is a learner starting the wrong lesson.
 *
 * For the CAP they are not residual, they are the main road. The exercise
 * checkpoint's "Continue" replays a stored deep link into a lecture — an
 * ordinary daily path, not a clever one — so a cap that closed only the grid
 * would be a cap that never fired. All three routes read it.
 *
 * `gated` and `videosLocked` are distinct verdicts and both are exercised here:
 * a capped learner is by definition NOT gated (they have done today's lesson),
 * so a test that only set `gated` would prove nothing about this.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CourseGridRoute, CourseDetailRoute, LecturePlayerRoute } from './Videos.jsx';

const OPEN = {
  status: 'ready', pending: false, gated: false, course: null,
  videosLocked: false, videos: { locked: false, reason: 'no-cap', completedToday: 0, cap: null },
};
const CAPPED = {
  status: 'ready', pending: false, gated: false, course: null,
  videosLocked: true, videos: { locked: true, reason: 'daily-cap', completedToday: 2, cap: 2 },
};

const state = { gate: { ...OPEN }, user: 'learner-one' };
const info = vi.hoisted(() => vi.fn());

vi.mock('../../PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({ basePath: '/piano', config: { videos: {} } }),
}));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: state.user }) }));
vi.mock('../../PianoMidiContext.jsx', () => ({ usePianoMidi: () => ({ speakerConnected: true }) }));
vi.mock('../../usePianoLessonGate.js', async () => ({
  ...(await vi.importActual('../../usePianoLessonGate.js')),
  default: () => state.gate,
}));
vi.mock('./usePianoCoursePlayable.js', () => ({
  default: () => ({ items: [], info: { title: 'Course' }, isSequential: false }),
  usePianoCoursePlayable: () => ({ items: [], info: { title: 'Course' }, isSequential: false }),
}));
vi.mock('./CourseGrid.jsx', () => ({ default: () => <div data-testid="course-grid" /> }));
vi.mock('./CourseDetail.jsx', () => ({ default: () => <div data-testid="course-detail" /> }));
vi.mock('./SubcourseNavigator.jsx', () => ({ default: () => <div data-testid="subcourse-nav" /> }));
vi.mock('./PianoVideoPlayer.jsx', () => ({ default: () => <div data-testid="player" /> }));
vi.mock('../../../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info, debug() {}, warn() {}, error() {} }) }),
}));

const renderAt = (path, element) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/piano" element={<div data-testid="menu" />} />
      <Route path="/piano/videos" element={<CourseGridRoute groups={[]} />} />
      <Route path="/piano/videos/:courseId" element={<CourseDetailRoute />} />
      <Route path="/piano/videos/:courseId/:lectureId" element={<LecturePlayerRoute />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  state.gate = { ...OPEN };
  state.user = 'learner-one';
  info.mockClear();
});

describe('Videos under the daily cap', () => {
  it('shows the grid to a learner under the cap', () => {
    renderAt('/piano/videos');
    expect(screen.getByTestId('course-grid')).toBeTruthy();
  });

  it('sends a capped learner back to the menu from the grid', () => {
    state.gate = { ...CAPPED };
    renderAt('/piano/videos');
    expect(screen.queryByTestId('course-grid')).toBeNull();
    expect(screen.getByTestId('menu')).toBeTruthy();
  });

  // The deep-link doors. A cap that only closed the grid would be defeated by
  // the Continue button a child presses every day.
  it('sends a capped learner back to the menu from a course deep link', () => {
    state.gate = { ...CAPPED };
    renderAt('/piano/videos/plex:1');
    expect(screen.queryByTestId('course-detail')).toBeNull();
    expect(screen.getByTestId('menu')).toBeTruthy();
  });

  it('sends a capped learner back to the menu from a lecture deep link', () => {
    state.gate = { ...CAPPED };
    renderAt('/piano/videos/plex:1/plex:2');
    expect(screen.queryByTestId('player')).toBeNull();
    expect(screen.getByTestId('menu')).toBeTruthy();
  });

  it('leaves both deep links open for a learner under the cap', () => {
    renderAt('/piano/videos/plex:1');
    expect(screen.getByTestId('course-detail')).toBeTruthy();
  });

  it('records the cap redirect with the count that closed it', () => {
    state.gate = { ...CAPPED };
    renderAt('/piano/videos');
    expect(info).toHaveBeenCalledWith('piano.videos.cap-redirected', {
      learnerId: 'learner-one', completedToday: 2, cap: 2, route: 'grid',
    });
  });

  it('names the route it turned away, so the escape doors can be told apart', () => {
    state.gate = { ...CAPPED };
    renderAt('/piano/videos/plex:1/plex:2');
    expect(info).toHaveBeenCalledWith('piano.videos.cap-redirected', {
      learnerId: 'learner-one', completedToday: 2, cap: 2, route: 'lecture',
    });
  });
});
