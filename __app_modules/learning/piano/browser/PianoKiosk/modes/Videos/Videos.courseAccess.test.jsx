// Videos.courseAccess.test.jsx — `courseAccess.disabledFor` closes every Courses
// route (grid, course, lecture deep link) for that player, and leaves the
// Videos flow open when another mode (Playalong, Singalong) supplies its own source.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Videos } from './Videos.jsx';
import { coursesDisabledFor } from '../../courseAccessPolicy.js';

const state = { user: 'kid', config: { videos: { collections: [] }, courseAccess: { disabledFor: ['kid'] } } };

vi.mock('../../PianoConfig.jsx', () => ({ usePianoKioskConfig: () => ({ config: state.config }) }));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: state.user }) }));
// The routes themselves are not under test; each renders a marker.
vi.mock('./CourseGrid.jsx', () => ({ default: () => <div data-testid="grid" /> }));

const renderAt = (path, props = {}) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/videos/*" element={<Videos {...props} />} />
    </Routes>
  </MemoryRouter>,
);

describe('courseAccessPolicy', () => {
  it('matches trimmed, case-folded ids and treats absent config as open', () => {
    expect(coursesDisabledFor({ disabledFor: [' Kid '] }, 'kid')).toBe(true);
    expect(coursesDisabledFor({ disabledFor: ['kid'] }, 'sib')).toBe(false);
    expect(coursesDisabledFor(undefined, 'kid')).toBe(false);
    expect(coursesDisabledFor({ disabledFor: ['kid'] }, null)).toBe(false);
  });
});

describe('Videos under courseAccess', () => {
  beforeEach(() => { state.user = 'kid'; });

  it.each(['/videos', '/videos/675689', '/videos/675689/676052'])('closes %s for a player the courses are off for', (path) => {
    renderAt(path);
    expect(screen.getByRole('status').textContent).toMatch(/Courses are off/);
  });

  it('leaves the flow open when another mode supplies its own source', () => {
    renderAt('/videos', { source: { collections: [] } });
    expect(screen.queryByText(/Courses are off/)).toBeNull();
  });

  it('leaves other players alone', () => {
    state.user = 'sib';
    renderAt('/videos');
    expect(screen.queryByText(/Courses are off/)).toBeNull();
  });
});
