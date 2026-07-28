import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let response;
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(() => Promise.resolve(response)) }));
import { DaylightAPI } from '../../../lib/api.mjs';
import PianoMenuActivity, { relativeTime } from './PianoMenuActivity.jsx';

const NOW = Date.parse('2026-07-28T12:00:00Z');
const course = (over = {}) => ({
  courseId: 'plex:11', courseTitle: 'Course B', thumbnail: '/img/b',
  completed: 13, total: 57, percent: 23, lastPlayedAt: '2026-07-28T10:00:00Z', ...over,
});
const player = (over = {}) => ({
  userId: 'felix', name: 'Felix', lastPlayedAt: '2026-07-28T10:00:00Z',
  courses: [course()], ...over,
});

beforeEach(() => { DaylightAPI.mockClear(); response = { players: [] }; });

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
      player({ userId: 'soren', name: 'Soren', courses: [
        course({ courseId: 'plex:13', courseTitle: 'Hoffman Academy', thumbnail: '/img/h', completed: 3, total: 344, percent: 1 }),
      ] }),
    ] };
    render(<PianoMenuActivity onOpenCourse={() => {}} />);
    await waitFor(() => expect(document.querySelectorAll('.piano-menu-activity__card')).toHaveLength(2));
    // felix's card: two course thumbnails, each with its percent underneath
    const cards = document.querySelectorAll('.piano-menu-activity__card');
    expect(cards[0].querySelectorAll('.piano-menu-activity__course')).toHaveLength(2);
    expect(cards[0].textContent).toContain('23%');
    expect(cards[0].textContent).toContain('1%');
    expect(screen.getByAltText('Course B').getAttribute('src')).toBe('/img/b');
    expect(screen.getByAltText('Hoffman Academy')).toBeTruthy();
    // Course title text is NOT rendered as a visible label when a thumbnail exists
    expect(screen.queryByText('Course B')).toBeNull();
  });

  it('dims players idle beyond 7 days (keyed off newest course)', async () => {
    response = { players: [player({ lastPlayedAt: '2026-07-10T00:00:00Z' })] };
    render(<PianoMenuActivity onOpenCourse={() => {}} />);
    await waitFor(() => expect(document.querySelector('.piano-menu-activity__card')).toBeTruthy());
    expect(document.querySelector('.piano-menu-activity__card').className).toContain('is-stale');
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
    expect(onOpenCourse).toHaveBeenCalledWith('plex:12');
  });

  it('falls back to a text tile when a course has no thumbnail', async () => {
    response = { players: [player({ courses: [course({ thumbnail: null })] })] };
    render(<PianoMenuActivity onOpenCourse={() => {}} />);
    await waitFor(() => expect(screen.getByText('Course B')).toBeTruthy());
    expect(screen.getByText('Course B').className).toContain('piano-menu-activity__thumb--fallback');
  });

  it('renders nothing when there are no players or the fetch fails', async () => {
    const { container } = render(<PianoMenuActivity onOpenCourse={() => {}} />);
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
