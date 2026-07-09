import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumb: () => {} }));

import SubcourseNavigator from './SubcourseNavigator.jsx';

const ep = (p, i, title, watched = false) => ({ id: `plex:${i}`, plex: String(i), parentId: String(p), itemIndex: i, title, label: title, userWatched: watched, image: `/t${i}.jpg`, duration: 300 });

const playable = {
  info: { title: 'Piano With Jonny', image: '/poster.jpg', labels: ['subcourses'] },
  parents: { 700: { index: 0, title: 'Practice Essentials' }, 701: { index: 1, title: 'Pop Soloing' } },
  referenceUnitIds: ['700'],
  items: [
    ep(700, 101, 'Practice – A'),
    ep(701, 101, 'Solo with X – 1', true), ep(701, 102, 'Solo with X – 2', false),
    ep(701, 201, 'Solo with Y – 1', false),
  ],
};

describe('SubcourseNavigator (redesign)', () => {
  it('season menu shows a graded season and a resources season', () => {
    render(<SubcourseNavigator course={{ id: '676490' }} playable={playable} onPlay={vi.fn()} />);
    // Season rows set title={name} — the rail's Continue sub-label also renders the
    // season name ("Pop Soloing"), so scope to the row via getByTitle to stay unique.
    expect(screen.getByTitle('Pop Soloing')).toBeTruthy();
    expect(screen.getByTitle('Practice Essentials')).toBeTruthy();
    expect(screen.getByText(/open anytime/)).toBeTruthy();
  });

  it('Continue in the rail plays the first unwatched lesson', () => {
    const onPlay = vi.fn();
    render(<SubcourseNavigator course={{ id: '676490' }} playable={playable} onPlay={onPlay} />);
    // Rail Continue button renders the target lesson's label ("Solo with X – 2").
    fireEvent.click(screen.getByText('Solo with X – 2').closest('button'));
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ plex: '102' }));
  });

  it('drills graded season → course → lesson', () => {
    const onPlay = vi.fn();
    render(<SubcourseNavigator course={{ id: '676490' }} playable={playable} onPlay={onPlay} />);
    fireEvent.click(screen.getByTitle('Pop Soloing'));
    // Course card sets title={c.label} — the shared-prefix-derived course label, not a lesson title.
    fireEvent.click(screen.getByTitle('Solo with X'));
    fireEvent.click(screen.getByText('Solo with X – 1').closest('button'));
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ plex: '101' }));
  });
});
