import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumb: () => {} }));

import SubcourseNavigator from './SubcourseNavigator.jsx';

const ep = (parentId, itemIndex, title, extra = {}) => ({
  id: `plex:${itemIndex}`, plex: String(itemIndex), parentId: String(parentId), itemIndex, title, label: title, ...extra,
});

// Specials = single course (collapses); Season 1 = two courses.
const playable = {
  info: { title: 'Piano With Jonny', image: '/poster.jpg', labels: ['subcourses'] },
  parents: {
    676540: { index: 0, title: 'Specials' },
    676507: { index: 1, title: 'Season 1' },
  },
  items: [
    ep(676540, 101, 'Practice Essentials – How to Practice'),
    ep(676507, 101, 'Pop Soloing – Pop Chords'),
    ep(676507, 201, 'Slip Notes – Intro'),
  ],
};

describe('SubcourseNavigator', () => {
  it('starts on the season menu', () => {
    render(<SubcourseNavigator course={{ id: '676490' }} playable={playable} onPlay={vi.fn()} />);
    expect(screen.getByText('Specials')).toBeTruthy();
    expect(screen.getByText('Season 1')).toBeTruthy();
  });

  it('multi-course season → course list → lessons', () => {
    const onPlay = vi.fn();
    render(<SubcourseNavigator course={{ id: '676490' }} playable={playable} onPlay={onPlay} />);
    fireEvent.click(screen.getByTitle('Season 1'));
    expect(screen.getByText('Pop Soloing')).toBeTruthy(); // course tile
    expect(screen.getByText('Slip Notes')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Pop Soloing'));
    fireEvent.click(screen.getByText('Pop Soloing – Pop Chords').closest('button'));
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ plex: '101', parentId: '676507' }));
  });

  it('single-course season collapses straight to its lessons', () => {
    render(<SubcourseNavigator course={{ id: '676490' }} playable={playable} onPlay={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Specials'));
    // No course-list step; the lesson is shown directly.
    expect(screen.getByText('Practice Essentials – How to Practice')).toBeTruthy();
  });
});
