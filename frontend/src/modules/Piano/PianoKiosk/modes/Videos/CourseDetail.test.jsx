import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let hookReturn;
vi.mock('./usePianoCoursePlayable.js', () => ({ usePianoCoursePlayable: () => hookReturn }));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: 'milo', currentProfile: { name: 'Milo' } }) }));
vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumb: () => {} }));
vi.mock('../../PianoEmpty.jsx', () => ({ default: ({ loading, message }) => <div data-testid="empty">{loading ? 'loading' : message}</div> }));

import CourseDetail from './CourseDetail.jsx';

const baseHook = { items: null, info: {}, parents: null, isSequential: false, loading: false, error: null };
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

  it('shows a watched check for user-watched lectures', () => {
    hookReturn = { ...baseHook, items: [{ plex: '1', label: 'A', itemIndex: 1, userWatched: true, userPercent: 100 }] };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={vi.fn()} />);
    expect(screen.getByLabelText('Watched')).toBeTruthy();
  });

  it('shows the loading state', () => {
    hookReturn = { ...baseHook, items: null, loading: true };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={vi.fn()} />);
    expect(screen.getByTestId('empty').textContent).toBe('loading');
  });
});
