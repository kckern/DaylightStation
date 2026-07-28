import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let response;
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(() => Promise.resolve(response)) }));
import { DaylightAPI } from '../../../lib/api.mjs';
import PianoMenuActivity, { relativeTime } from './PianoMenuActivity.jsx';

const NOW = Date.parse('2026-07-28T12:00:00Z');
const player = (over = {}) => ({
  userId: 'felix', name: 'Felix', courseId: 'plex:11', courseTitle: 'Course B',
  thumbnail: '/img/b', completed: 13, total: 57, percent: 23,
  lastPlayedAt: '2026-07-28T10:00:00Z', ...over,
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
  it('renders one card per player with ring percent, title, and relative time', async () => {
    response = { players: [player(), player({ userId: 'soren', name: 'Soren', percent: 1, completed: 3, total: 344, courseTitle: 'Hoffman Academy' })] };
    render(<PianoMenuActivity onOpenCourse={() => {}} />);
    await waitFor(() => expect(screen.getByText('Course B')).toBeTruthy());
    expect(screen.getByText('Hoffman Academy')).toBeTruthy();
    expect(screen.getByText('23%')).toBeTruthy();
    expect(document.querySelectorAll('.piano-menu-activity__card')).toHaveLength(2);
  });

  it('dims players idle beyond 7 days', async () => {
    response = { players: [player({ lastPlayedAt: '2026-07-10T00:00:00Z' })] };
    render(<PianoMenuActivity onOpenCourse={() => {}} />);
    await waitFor(() => expect(document.querySelector('.piano-menu-activity__card')).toBeTruthy());
    expect(document.querySelector('.piano-menu-activity__card').className).toContain('is-stale');
  });

  it('tapping a card opens that course', async () => {
    const onOpenCourse = vi.fn();
    response = { players: [player()] };
    render(<PianoMenuActivity onOpenCourse={onOpenCourse} />);
    await waitFor(() => expect(screen.getByText('Course B')).toBeTruthy());
    fireEvent.click(screen.getByText('Course B').closest('button'));
    expect(onOpenCourse).toHaveBeenCalledWith('plex:11');
  });

  it('renders nothing when there are no players or the fetch fails', async () => {
    const { container } = render(<PianoMenuActivity onOpenCourse={() => {}} />);
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
