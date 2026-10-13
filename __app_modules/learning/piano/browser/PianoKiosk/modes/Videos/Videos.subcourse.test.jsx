import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

let hookReturn;
vi.mock('./usePianoCoursePlayable.js', () => ({ usePianoCoursePlayable: () => hookReturn }));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: 'test-user', currentProfile: {}, users: [] }) }));
vi.mock('./CourseDetail.jsx', () => ({ default: () => <div data-testid="flat">FLAT</div> }));
vi.mock('./SubcourseNavigator.jsx', () => ({ default: () => <div data-testid="nav">NAV</div> }));
vi.mock('../../PianoMidiContext.jsx', () => ({ usePianoMidi: () => ({ speakerConnected: true }) }));
// This route reads the kiosk config and the lesson gate since 2026-09-02: the
// daily video cap is enforced at all three Videos routes, not only the grid,
// because the exercise checkpoint's Continue deep-links straight past it. Open
// verdict here — the branch under test is the subcourse split, not the cap.
vi.mock('../../PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({ basePath: '/piano', config: { videos: {} } }),
}));
vi.mock('../../usePianoLessonGate.js', async () => ({
  ...(await vi.importActual('../../usePianoLessonGate.js')),
  default: () => ({ status: 'ready', pending: false, gated: false, videosLocked: false, videos: { locked: false } }),
}));

import { CourseDetailRoute } from './Videos.jsx';

const renderRoute = () => render(
  <MemoryRouter initialEntries={['/676490']}>
    <Routes><Route path=":courseId" element={<CourseDetailRoute />} /></Routes>
  </MemoryRouter>,
);

describe('CourseDetailRoute branch', () => {
  beforeEach(() => { hookReturn = { items: null, info: {}, parents: null, isSequential: false, loading: true, error: null }; });

  it('renders the flat CourseDetail for a non-subcourses show', () => {
    hookReturn = { ...hookReturn, loading: false, info: { type: 'show', labels: [] } };
    renderRoute();
    expect(screen.getByTestId('flat')).toBeTruthy();
  });

  it('renders the SubcourseNavigator when the show is labeled subcourses', () => {
    hookReturn = { ...hookReturn, loading: false, info: { type: 'show', labels: ['subcourses'] } };
    renderRoute();
    expect(screen.getByTestId('nav')).toBeTruthy();
  });
});
