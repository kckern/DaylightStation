import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// 12 courses in one collection, so the wall renders a real multi-row split
// (balancedGrid(12)) without waiting on network — usePianoList resolves
// synchronously from this canned payload. Payloads are STABLE references (a
// fresh object per call would retrigger CollectionFetcher's effect every
// render → infinite loop — see CourseGrid.tabs.test.jsx).
const ITEMS = Array.from({ length: 12 }, (_, i) => ({ id: `plex:${i}`, title: `Course ${i}`, type: 'show' }));
const COLLECTION = { data: { title: 'Courses', items: ITEMS } };
const EMPTY_LIST = { data: [] };
const EMPTY_OBJ = { data: {} };
vi.mock('../../usePianoList.js', () => ({
  default: (path) => {
    if (!path) return EMPTY_LIST;
    if (path.includes('list/plex/1')) return COLLECTION;
    return EMPTY_OBJ; // progress map fetch
  },
}));
vi.mock('./CourseTile.jsx', () => ({ default: ({ item }) => <li>{item.title}</li> }));

import CourseGrid from './CourseGrid.jsx';
import { tileScaleFor } from './tileScale.js';
import { balancedGrid } from '../../tileGridLayout.js';

describe('CourseGrid one-page adaptive wall', () => {
  it('sizes the poster wall to a balanced rows×cols split, sets the density scale, and marks the no-scroll wrapper', async () => {
    const groups = [{ label: 'Lessons', collections: ['plex:1'] }];
    const { container } = render(<CourseGrid groups={groups} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Course 0')).toBeTruthy());

    // The scroll-killing wrapper class lives on the mode root.
    expect(container.querySelector('.piano-mode--videos-grid')).toBeTruthy();

    const grid = container.querySelector('.piano-video-grid--onepage');
    expect(grid).toBeTruthy();
    const { rows, cols } = balancedGrid(12); // 12 → 3×4 (see tileGridLayout.test.js)
    expect(grid.style.getPropertyValue('--cols')).toBe(String(cols));
    expect(grid.style.getPropertyValue('--rows')).toBe(String(rows));
    // 3 rows → badge/progress overlays scale down (tileScaleFor(3) = 0.85),
    // not the full-size 1 used at ≤2 rows.
    expect(grid.style.getPropertyValue('--tile-scale')).toBe(String(tileScaleFor(rows)));
    expect(rows).toBe(3);
    expect(grid.style.getPropertyValue('--tile-scale')).toBe('0.85');
  });
});

describe('tileScaleFor', () => {
  it('stays full-size at ≤2 rows and steps down at 3/4/5+', () => {
    expect(tileScaleFor(1)).toBe(1);
    expect(tileScaleFor(2)).toBe(1);
    expect(tileScaleFor(3)).toBe(0.85);
    expect(tileScaleFor(4)).toBe(0.7);
    expect(tileScaleFor(5)).toBe(0.55);
    expect(tileScaleFor(8)).toBe(0.55);
  });
});
