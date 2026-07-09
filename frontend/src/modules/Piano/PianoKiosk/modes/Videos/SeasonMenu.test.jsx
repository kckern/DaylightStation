import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SeasonMenu from './SeasonMenu.jsx';

const seasons = [
  { id: '676540', index: 0, title: 'Specials', thumbnail: '/s0.jpg',
    lessons: [{ plex: '1', userWatched: true }], courses: [{ floor: 1 }] },
  { id: '676507', index: 1, title: 'Season 1', thumbnail: null,
    lessons: [{ plex: '2', userWatched: false }, { plex: '3', userWatched: false }], courses: [{ floor: 1 }, { floor: 2 }] },
];

describe('SeasonMenu', () => {
  it('renders each season with course count and watched/total', () => {
    render(<SeasonMenu seasons={seasons} poster="/p.jpg" onSelect={() => {}} />);
    expect(screen.getByText('Specials')).toBeTruthy();
    expect(screen.getByText('1 course · 1/1')).toBeTruthy();
    expect(screen.getByText('2 courses · 0/2')).toBeTruthy();
  });

  it('calls onSelect with the season when tapped', () => {
    const onSelect = vi.fn();
    render(<SeasonMenu seasons={seasons} poster="/p.jpg" onSelect={onSelect} />);
    fireEvent.click(screen.getByTitle('Season 1'));
    expect(onSelect).toHaveBeenCalledWith(seasons[1]);
  });
});
