import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let hookReturn;
vi.mock('./usePianoCoursePlayable.js', () => ({ usePianoCoursePlayable: () => hookReturn }));
vi.mock('../../PianoUserContext.jsx', () => ({
  usePianoUser: () => ({
    currentUser: 'user_3',
    currentProfile: { name: 'User_3' },
    users: [{ id: 'user_3', name: 'User_3' }, { id: 'user_2', name: 'User_2' }],
  }),
}));
vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumb: () => {} }));
vi.mock('../../PianoEmpty.jsx', () => ({ default: ({ loading, message }) => <div data-testid="empty">{loading ? 'loading' : message}</div> }));

import CourseDetail from './CourseDetail.jsx';

const baseHook = { items: null, info: {}, parents: null, isSequential: false, loading: false, error: null, coProgressLock: null, referenceUnitIds: [] };
beforeEach(() => { hookReturn = { ...baseHook }; });

describe('CourseDetail', () => {
  it('renders all lectures for a non-sequential flat course', () => {
    hookReturn = { ...baseHook, items: [
      { plex: '1', label: 'A', itemIndex: 1 },
      { plex: '2', label: 'B', itemIndex: 2 },
    ] };
    render(<CourseDetail course={{ id: 'plex:99', title: 'Course' }} onPlay={vi.fn()} />);
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByText('B')).toBeTruthy();
  });

  it('shows the completion date on a watched lecture (✓ + formatted date)', () => {
    hookReturn = { ...baseHook, items: [
      { plex: '1', label: 'A', itemIndex: 1, userWatched: true, userPercent: 95, userCompletedAt: '2026-04-20T10:00:00Z' },
    ] };
    render(<CourseDetail course={{ id: 'plex:99', title: 'Course' }} onPlay={vi.fn()} />);
    const check = document.querySelector('.piano-episode__check');
    expect(check).toBeTruthy();
    expect(check.textContent).toContain('Apr 20'); // formatFitnessDate → "Mon, Apr 20"
  });

  it('marks the first unwatched episode as current (goldenrod) in a sequential course', () => {
    hookReturn = { ...baseHook, isSequential: true, items: [
      { plex: '1', label: 'A', itemIndex: 1, userWatched: true },
      { plex: '2', label: 'B', itemIndex: 2, userWatched: false },
      { plex: '3', label: 'C', itemIndex: 3, userWatched: false },
    ] };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={vi.fn()} />);
    const bBtn = screen.getByText('B').closest('button');
    const aBtn = screen.getByText('A').closest('button');
    const cBtn = screen.getByText('C').closest('button');
    expect(bBtn.className).toContain('piano-episode--current');
    expect(bBtn.getAttribute('aria-current')).toBe('true');
    // watched (A) and locked (C) are NOT the current lesson
    expect(aBtn.className).not.toContain('piano-episode--current');
    expect(cBtn.className).not.toContain('piano-episode--current');
  });

  it('does not mark any episode current in a non-sequential course', () => {
    hookReturn = { ...baseHook, isSequential: false, items: [
      { plex: '1', label: 'A', itemIndex: 1, userWatched: false },
      { plex: '2', label: 'B', itemIndex: 2, userWatched: false },
    ] };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={vi.fn()} />);
    expect(screen.getByText('A').closest('button').className).not.toContain('piano-episode--current');
  });

  it('locks episodes after the first unwatched one in a sequential course', () => {
    const onPlay = vi.fn();
    hookReturn = { ...baseHook, isSequential: true, items: [
      { plex: '1', label: 'A', itemIndex: 1, userWatched: true },
      { plex: '2', label: 'B', itemIndex: 2, userWatched: false },
      { plex: '3', label: 'C', itemIndex: 3, userWatched: false },
    ] };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={onPlay} />);
    // B (first unwatched) is playable; C is locked
    fireEvent.click(screen.getByText('C').closest('button'));
    expect(onPlay).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('B').closest('button'));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('hides seasons after the first incomplete season (sequential multi-season)', () => {
    hookReturn = { ...baseHook, isSequential: true,
      parents: { s1: { index: 1, title: 'Unit 1' }, s2: { index: 2, title: 'Unit 2' } },
      items: [
        { plex: '1', label: 'A', itemIndex: 1, parentId: 's1', userWatched: false },
        { plex: '2', label: 'B', itemIndex: 1, parentId: 's2', userWatched: false },
      ],
    };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={vi.fn()} />);
    expect(screen.getByText('Unit 1')).toBeTruthy();
    expect(screen.queryByText('Unit 2')).toBeNull(); // hidden until Unit 1 complete
    expect(screen.queryByText('B')).toBeNull();
  });

  it('reveals the next season once the prior one is complete', () => {
    hookReturn = { ...baseHook, isSequential: true,
      parents: { s1: { index: 1, title: 'Unit 1' }, s2: { index: 2, title: 'Unit 2' } },
      items: [
        { plex: '1', label: 'A', itemIndex: 1, parentId: 's1', userWatched: true },
        { plex: '2', label: 'B', itemIndex: 1, parentId: 's2', userWatched: false },
      ],
    };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={vi.fn()} />);
    expect(screen.getByText('Unit 1')).toBeTruthy();
    expect(screen.getByText('Unit 2')).toBeTruthy(); // s1 complete → s2 visible
  });

  it('shows a completed check for user-watched lectures (no date when none recorded)', () => {
    hookReturn = { ...baseHook, items: [{ plex: '1', label: 'A', itemIndex: 1, userWatched: true, userPercent: 100 }] };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={vi.fn()} />);
    expect(screen.getByLabelText('Completed')).toBeTruthy();
  });

  it('shows shimmer skeleton tiles (standard grid) while loading — not a text loader', () => {
    hookReturn = { ...baseHook, items: null, loading: true };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={vi.fn()} />);
    expect(screen.queryByTestId('empty')).toBeNull();           // no text loader
    expect(document.querySelector('.piano-episodes')).toBeTruthy(); // standard grid
    expect(document.querySelectorAll('.piano-episode--skeleton').length).toBeGreaterThan(0);
  });
});

describe('co-progress lock', () => {
  it('shows the two-person icon on the co-progress-locked episode, not the standard lock', () => {
    hookReturn = {
      ...baseHook,
      isSequential: true,
      coProgressLock: { locked: true, aheadBy: 5, waitingForId: 'user_2', buffer: 5 },
      items: [
        { plex: '1', label: 'A', itemIndex: 1, userWatched: true },
        { plex: '2', label: 'B', itemIndex: 2, userWatched: false },
        { plex: '3', label: 'C', itemIndex: 3, userWatched: false },
      ],
    };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={vi.fn()} />);
    // B is the first unwatched: co-progress-locked → two-person icon
    expect(screen.getByLabelText('Waiting for partner')).toBeTruthy();
    // C is sequentially locked → standard lock icon
    expect(screen.getByLabelText('Locked')).toBeTruthy();
  });

  it('shows a toast with the partner name on tap of the co-progress-locked episode', () => {
    const onPlay = vi.fn();
    hookReturn = {
      ...baseHook,
      isSequential: true,
      coProgressLock: { locked: true, aheadBy: 5, waitingForId: 'user_2', buffer: 5 },
      items: [
        { plex: '1', label: 'A', itemIndex: 1, userWatched: true },
        { plex: '2', label: 'B', itemIndex: 2, userWatched: false },
        { plex: '3', label: 'C', itemIndex: 3, userWatched: false },
      ],
    };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={onPlay} />);
    fireEvent.click(screen.getByText('B').closest('button'));
    expect(onPlay).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('User_2');
    expect(screen.getByRole('status').textContent).toContain('5 episodes ahead');
  });

  it('does not apply the co-progress lock when coProgressLock is null', () => {
    const onPlay = vi.fn();
    hookReturn = {
      ...baseHook,
      isSequential: true,
      coProgressLock: null,
      items: [
        { plex: '1', label: 'A', itemIndex: 1, userWatched: true },
        { plex: '2', label: 'B', itemIndex: 2, userWatched: false },
      ],
    };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={onPlay} />);
    fireEvent.click(screen.getByText('B').closest('button'));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });
});

describe('reference units + descending order', () => {
  it('renders multi-unit LESSON units in descending order (latest on top)', () => {
    hookReturn = {
      ...baseHook,
      isSequential: false,
      parents: { s1: { index: 1, title: 'Unit 1' }, s2: { index: 2, title: 'Unit 2' } },
      items: [
        { plex: '1', label: 'A', itemIndex: 1, parentId: 's1', userWatched: false },
        { plex: '2', label: 'B', itemIndex: 1, parentId: 's2', userWatched: false },
      ],
    };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={vi.fn()} />);
    const titles = Array.from(document.querySelectorAll('.piano-course__season-title')).map((e) => e.textContent);
    expect(titles).toEqual(['Unit 2', 'Unit 1']); // descending
  });

  const refHook = {
    ...baseHook,
    isSequential: true,
    referenceUnitIds: ['s3'],
    parents: { s1: { index: 1, title: 'Unit 1' }, s3: { index: 3, title: 'Exercise Module' } },
    items: [
      { plex: '1', label: 'L1', itemIndex: 1, parentId: 's1', userWatched: false },
      { plex: '2', label: 'L2', itemIndex: 2, parentId: 's1', userWatched: false },
      { plex: '9', label: 'Drill', itemIndex: 1, parentId: 's3', userWatched: false },
    ],
  };

  it('offers a Practice & Reference toggle in the info panel, collapsed by default', () => {
    hookReturn = { ...refHook };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={vi.fn()} />);
    const toggle = screen.getByRole('switch', { name: /Practice & Reference/i });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText('Drill')).toBeNull(); // hidden until toggled on
  });

  it('toggling the switch reveals then hides the reference units', () => {
    hookReturn = { ...refHook };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={vi.fn()} />);
    const toggle = screen.getByRole('switch', { name: /Practice & Reference/i });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Drill')).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByText('Drill')).toBeNull();
  });

  it('reference units are ungated and playable once revealed', () => {
    const onPlay = vi.fn();
    hookReturn = { ...refHook };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={onPlay} />);
    fireEvent.click(screen.getByRole('switch', { name: /Practice & Reference/i }));
    const drill = screen.getByText('Drill').closest('button');
    expect(drill).not.toBeDisabled();
    fireEvent.click(drill);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('keeps the lesson gate working while reference units are revealed', () => {
    hookReturn = { ...refHook };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={vi.fn()} />);
    fireEvent.click(screen.getByRole('switch', { name: /Practice & Reference/i }));
    expect(screen.getByText('L2').closest('button')).toBeDisabled();      // gated lesson
    expect(screen.getByText('Drill').closest('button')).not.toBeDisabled(); // open reference
  });

  it('shows no Practice & Reference toggle when referenceUnitIds is empty', () => {
    hookReturn = {
      ...baseHook,
      isSequential: true,
      parents: { s1: { index: 1, title: 'Unit 1' }, s2: { index: 2, title: 'Unit 2' } },
      items: [
        { plex: '1', label: 'A', itemIndex: 1, parentId: 's1', userWatched: true },
        { plex: '2', label: 'B', itemIndex: 1, parentId: 's2', userWatched: false },
      ],
    };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={vi.fn()} />);
    expect(screen.queryByText(/Practice & Reference/)).toBeNull();
  });
});
