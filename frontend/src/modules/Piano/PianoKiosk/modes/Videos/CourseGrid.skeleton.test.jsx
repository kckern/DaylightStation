import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Keep usePianoList permanently "loading" (data === null) so every collection a
// group lists reports null → merged stays null → courses stays null → the wall's
// `loading` flag is true. CourseTile is stubbed since no tiles render while loading.
vi.mock('../../usePianoList.js', () => ({ default: () => ({ data: null }) }));
vi.mock('./CourseTile.jsx', () => ({ default: () => null }));

import CourseGrid from './CourseGrid.jsx';

describe('CourseGrid loading state', () => {
  it('renders poster skeletons while the wall is loading', () => {
    const groups = [{ label: 'Lessons', collections: ['plex:1'] }];
    const { container } = render(<CourseGrid groups={groups} onSelect={() => {}} />);
    expect(container.querySelectorAll('.piano-skeleton--poster').length).toBe(8);
  });
});
