import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let response;
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(() => Promise.resolve(response)) }));
import { DaylightAPI } from '../../../lib/api.mjs';
import PianoMenuActivity, { relativeTime, readShape, writeShape } from './PianoMenuActivity.jsx';
import { __clearPianoListCache } from './usePianoList.js';

const NOW = Date.parse('2026-07-28T12:00:00Z');
const course = (over = {}) => ({
  courseId: 'plex:11', courseTitle: 'Course B', thumbnail: '/img/b',
  completed: 13, total: 57, percent: 23, units: ['done', 'active', 'todo'],
  lastPlayedAt: '2026-07-28T10:00:00Z', ...over,
});
const player = (over = {}) => ({
  userId: 'learner2', name: 'learner2', lastPlayedAt: '2026-07-28T10:00:00Z',
  courses: [course()], ...over,
});

beforeEach(() => {
  DaylightAPI.mockClear();
  response = { players: [] };
  __clearPianoListCache(); // module-level SWR cache would leak between tests
  localStorage.clear();
});

// The loading skeleton reuses the strip's own card/poster classes (that's the
// point — identical geometry), so "the data landed" has to be asserted against
// the non-skeleton strip or a test can pass on placeholders.
const loadedStrip = () => document.querySelector('.piano-menu-activity:not(.piano-menu-activity--skeleton)');
const loadedCards = () => loadedStrip()?.querySelectorAll('.piano-menu-activity__card') ?? [];

describe('relativeTime', () => {
  it('formats minutes, hours, days', () => {
    expect(relativeTime('2026-07-28T11:59:40Z', NOW)).toBe('just now');
    expect(relativeTime('2026-07-28T11:35:00Z', NOW)).toBe('25m ago');
    expect(relativeTime('2026-07-28T09:00:00Z', NOW)).toBe('3h ago');
    expect(relativeTime('2026-07-23T09:00:00Z', NOW)).toBe('5d ago');
  });
});

describe('PianoMenuActivity', () => {
  it('renders one card per player with a thumbnail + percent per recent course', async () => {
    response = { players: [
      player({ courses: [
        course(),
        course({ courseId: 'plex:12', courseTitle: 'Course C', thumbnail: '/img/c', completed: 3, total: 344, percent: 1 }),
      ] }),
      player({ userId: 'learner1', name: 'learner1', courses: [
        course({ courseId: 'plex:13', courseTitle: 'Hoffman Academy', thumbnail: '/img/h', completed: 3, total: 344, percent: 1 }),
      ] }),
    ] };
    render(<PianoMenuActivity onOpenCourse={() => {}} />);
    await waitFor(() => expect(loadedCards()).toHaveLength(2));
    // learner2's card: two course thumbnails, each with its percent underneath
    const cards = loadedCards();
    expect(cards[0].querySelectorAll('.piano-menu-activity__course')).toHaveLength(2);
    expect(cards[0].textContent).toContain('23%');
    expect(cards[0].textContent).toContain('1%');
    // Thumbnails request a server-side resize (proxy ?w=&h= → Plex transcoder)
    expect(screen.getByAltText('Course B').getAttribute('src')).toBe('/img/b?w=140&h=200');
    expect(screen.getByAltText('Hoffman Academy')).toBeTruthy();
    // Course title text is NOT rendered as a visible label when a thumbnail exists
    expect(screen.queryByText('Course B')).toBeNull();
  });

  it('renders per-season dots in the overlay: done filled, active blinking, todo empty', async () => {
    response = { players: [player({ courses: [course({ units: ['done', 'active', 'todo', 'todo'] })] })] };
    render(<PianoMenuActivity onOpenCourse={() => {}} />);
    await waitFor(() => expect(document.querySelector('.piano-menu-activity__units')).toBeTruthy());
    const dots = document.querySelectorAll('.piano-menu-activity__unit');
    expect(dots).toHaveLength(4);
    expect(dots[0].className).toContain('is-done');
    expect(dots[1].className).toContain('is-active');
    expect(dots[2].className).toContain('is-todo');
    // Overlay sits on the poster, percent inside it
    const overlay = document.querySelector('.piano-menu-activity__overlay');
    expect(overlay.textContent).toContain('23%');
  });

  it('hides the dots row for single-unit courses', async () => {
    response = { players: [player({ courses: [course({ units: ['active'] })] })] };
    render(<PianoMenuActivity onOpenCourse={() => {}} />);
    await waitFor(() => expect(document.querySelector('.piano-menu-activity__overlay')).toBeTruthy());
    expect(document.querySelector('.piano-menu-activity__units')).toBeNull();
  });

  it('dims players idle beyond 7 days (keyed off newest course)', async () => {
    response = { players: [player({ lastPlayedAt: '2026-07-10T00:00:00Z' })] };
    render(<PianoMenuActivity onOpenCourse={() => {}} />);
    await waitFor(() => expect(loadedCards()).toHaveLength(1));
    expect(loadedCards()[0].className).toContain('is-stale');
  });

  it('tapping a course thumbnail opens that course', async () => {
    const onOpenCourse = vi.fn();
    response = { players: [player({ courses: [
      course(),
      course({ courseId: 'plex:12', courseTitle: 'Course C', thumbnail: '/img/c' }),
    ] })] };
    render(<PianoMenuActivity onOpenCourse={onOpenCourse} />);
    await waitFor(() => expect(screen.getByAltText('Course C')).toBeTruthy());
    fireEvent.click(screen.getByAltText('Course C').closest('button'));
    // Carries the card owner too — tapping a player's card also selects them.
    expect(onOpenCourse).toHaveBeenCalledWith('plex:12', 'learner2');
  });

  it('falls back to a text tile when a course has no thumbnail', async () => {
    response = { players: [player({ courses: [course({ thumbnail: null })] })] };
    render(<PianoMenuActivity onOpenCourse={() => {}} />);
    await waitFor(() => expect(screen.getByText('Course B')).toBeTruthy());
    expect(screen.getByText('Course B').className).toContain('piano-menu-activity__thumb--fallback');
  });

  it('renders nothing when there are no players or the fetch fails', async () => {
    const { container } = render(<PianoMenuActivity onOpenCourse={() => {}} />);
    await waitFor(() => expect(container.querySelector('.piano-menu-activity--skeleton')).toBeNull());
    expect(container.firstChild).toBeNull();
  });
});

describe('PianoMenuActivity — loading silhouette', () => {
  it('reserves the last-seen shape while loading, then swaps in the real strip', async () => {
    // A previous visit ended with a 2-course card and a 1-course card.
    writeShape([player({ courses: [course(), course()] }), player({ courses: [course()] })]);
    response = { players: [player({ courses: [course(), course()] }), player({ courses: [course()] })] };

    const { container } = render(<PianoMenuActivity onOpenCourse={() => {}} />);
    const skeleton = container.querySelector('.piano-menu-activity--skeleton');
    expect(skeleton).toBeTruthy(); // present on the FIRST paint — no empty gap
    const skelCards = skeleton.querySelectorAll('.piano-menu-activity__card');
    expect(skelCards).toHaveLength(2);
    expect(skelCards[0].querySelectorAll('.piano-menu-activity__skel-poster')).toHaveLength(2);
    expect(skelCards[1].querySelectorAll('.piano-menu-activity__skel-poster')).toHaveLength(1);

    await waitFor(() => expect(container.querySelector('.piano-menu-activity--skeleton')).toBeNull());
    expect(loadedCards()).toHaveLength(2);
  });

  it('reserves nothing when the last visit had no players', () => {
    writeShape([]);
    const { container } = render(<PianoMenuActivity onOpenCourse={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('records the rendered shape for the next cold load', async () => {
    response = { players: [player({ courses: [course(), course()] })] };
    render(<PianoMenuActivity onOpenCourse={() => {}} />);
    await waitFor(() => expect(loadedCards()).toHaveLength(1));
    expect(readShape()).toEqual([2]);
  });

  it('falls back to a modest default shape with nothing remembered', () => {
    expect(readShape()).toEqual([2, 2, 2]);
    localStorage.setItem('piano.menu-activity.shape', 'not json');
    expect(readShape()).toEqual([2, 2, 2]);
  });
});
