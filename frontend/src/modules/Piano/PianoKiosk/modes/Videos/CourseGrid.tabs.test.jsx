import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Canned payloads per list path — STABLE references (a fresh object per call
// would retrigger CollectionFetcher's effect every render → infinite loop).
// One collection holds a piano and a vocal course; the Voice tab cherry-picks
// the vocal show from the pool and pulls a standalone show via its own fetch.
vi.mock('../../usePianoList.js', () => {
  const COLLECTION = { data: { title: 'Modern Lessons', items: [
    { id: 'plex:10', title: 'Piano Course', type: 'show' },
    { id: 'plex:20', title: 'Vocal Course', type: 'show' },
  ] } };
  const STANDALONE = { data: { title: 'Singing from Scratch', items: [
    { id: 'plex:30', title: 'Singing Course', type: 'show' },
  ] } };
  const EMPTY_LIST = { data: [] };
  const EMPTY_OBJ = { data: {} };
  return {
    default: (path) => {
      if (!path) return EMPTY_LIST;
      if (path.includes('list/plex/1')) return COLLECTION;
      if (path.includes('list/plex/30')) return STANDALONE;
      return EMPTY_OBJ; // progress map fetch
    },
  };
});
vi.mock('./CourseTile.jsx', () => ({ default: ({ item }) => <li>{item.title}</li> }));

import CourseGrid from './CourseGrid.jsx';
import { resolveCourseGroups } from './courseGroups.js';

const GROUPS = [
  { label: 'Piano Lessons', collections: ['plex:1'], shows: [], excludeShows: ['plex:20'] },
  { label: 'Voice Lessons', collections: [], shows: ['plex:20', 'plex:30'], excludeShows: [] },
];

describe('resolveCourseGroups shows/exclude_shows passthrough', () => {
  it('normalizes shows and exclude_shows, keeps shows-only groups', () => {
    const groups = resolveCourseGroups({ collections: [
      { label: 'Piano Lessons', plex: ['plex:1'], exclude_shows: ['plex:20'] },
      { label: 'Voice Lessons', shows: 'plex:20' },
    ] });
    expect(groups).toHaveLength(2);
    expect(groups[0].excludeShows).toEqual(['plex:20']);
    expect(groups[1].collections).toEqual([]);
    expect(groups[1].shows).toEqual(['plex:20']);
  });
});

describe('CourseGrid tabs with shows/excludes', () => {
  it('excludes a show from its collection tab and adopts it on the shows tab', async () => {
    render(<CourseGrid groups={GROUPS} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Piano Course')).toBeTruthy());
    expect(screen.queryByText('Vocal Course')).toBeNull(); // excluded from Piano tab
    fireEvent.click(screen.getByRole('tab', { name: 'Voice Lessons' }));
    await waitFor(() => expect(screen.getByText('Vocal Course')).toBeTruthy());
    expect(screen.getByText('Singing Course')).toBeTruthy(); // standalone show, own fetch
    expect(screen.queryByText('Piano Course')).toBeNull(); // Voice tab has only its shows
  });

  it('swipes the content panel between tabs (horizontal-dominant, clamped)', async () => {
    const { container } = render(<CourseGrid groups={GROUPS} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Piano Course')).toBeTruthy());
    const panel = container.querySelector('.piano-course-tabpanel');

    // Swipe left → next tab
    fireEvent.touchStart(panel, { touches: [{ clientX: 320, clientY: 100 }] });
    fireEvent.touchEnd(panel, { changedTouches: [{ clientX: 100, clientY: 112 }] });
    await waitFor(() => expect(screen.getByText('Vocal Course')).toBeTruthy());

    // Swipe left again at the last tab → clamped, stays put
    fireEvent.touchStart(panel, { touches: [{ clientX: 320, clientY: 100 }] });
    fireEvent.touchEnd(panel, { changedTouches: [{ clientX: 100, clientY: 100 }] });
    expect(screen.getByText('Vocal Course')).toBeTruthy();

    // Swipe right → back to the first tab
    fireEvent.touchStart(panel, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(panel, { changedTouches: [{ clientX: 320, clientY: 96 }] });
    await waitFor(() => expect(screen.getByText('Piano Course')).toBeTruthy());

    // Vertical-dominant drag → ignored (poster-wall scrolling)
    fireEvent.touchStart(panel, { touches: [{ clientX: 300, clientY: 100 }] });
    fireEvent.touchEnd(panel, { changedTouches: [{ clientX: 220, clientY: 400 }] });
    expect(screen.getByText('Piano Course')).toBeTruthy();
  });
});
