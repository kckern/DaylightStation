import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RepertoireBrowser from './RepertoireBrowser.jsx';

const ep = (id, song, treatment, extra = {}) => ({
  plex: id, itemIndex: id, title: `${song} – ${treatment} lesson`,
  piano: { song, course: song, treatment, styles: ['Jazz Ballads'], skill: 'Beginner', instructor: 'Jonny May', ...extra },
});

const season = (lessons) => ({ id: 's8', index: 8, title: 'Song Library', lessons, courses: [] });

describe('RepertoireBrowser (song-first)', () => {
  it('renders one card per song with treatment chips', () => {
    render(<RepertoireBrowser season={season([
      ep(1, 'Misty', 'tutorial'), ep(2, 'Misty', 'challenge'),
      ep(3, 'Autumn Leaves', 'tutorial'),
    ])} onPlay={() => {}} />);
    expect(screen.getByText('2 songs')).toBeInTheDocument();
    const misty = screen.getByText('Misty').closest('button');
    expect(misty).toHaveTextContent('Tutorial');
    expect(misty).toHaveTextContent('Challenge');
    expect(misty).not.toHaveTextContent('Accompaniment');
  });

  it('multi-treatment song opens a song page with action buttons', () => {
    render(<RepertoireBrowser season={season([
      ep(1, 'Misty', 'tutorial'), ep(2, 'Misty', 'challenge'),
    ])} onPlay={() => {}} />);
    fireEvent.click(screen.getByText('Misty').closest('button'));
    expect(screen.getByText('Learn it')).toBeInTheDocument();
    expect(screen.getByText('Master it')).toBeInTheDocument();
    expect(screen.queryByText('Comp it')).toBeNull();
  });

  it('single-treatment song skips straight to its lessons', () => {
    render(<RepertoireBrowser season={season([ep(1, 'Blue Moon', 'tutorial')])} onPlay={() => {}} />);
    fireEvent.click(screen.getByText('Blue Moon').closest('button'));
    expect(screen.getByText('Blue Moon – tutorial lesson')).toBeInTheDocument(); // lesson row, no song page
  });

  it('treatment lessons are ungated and playable', () => {
    const onPlay = vi.fn();
    render(<RepertoireBrowser season={season([ep(1, 'Blue Moon', 'tutorial'), ep(2, 'Blue Moon', 'tutorial')])} onPlay={onPlay} />);
    fireEvent.click(screen.getByText('Blue Moon').closest('button'));
    const rows = screen.getAllByText(/tutorial lesson/).map((el) => el.closest('button'));
    rows.forEach((r) => expect(r).not.toBeDisabled());
    fireEvent.click(rows[1]);
    expect(onPlay).toHaveBeenCalled();
  });

  it('skill challenges render in their own shelf, not the catalog', () => {
    render(<RepertoireBrowser season={season([
      ep(1, 'Misty', 'tutorial'),
      { plex: 9, itemIndex: 9, title: 'Day 1', piano: { course: '10-Lesson Blues Challenge', treatment: 'challenge', skillChallenge: true } },
    ])} onPlay={() => {}} />);
    expect(screen.getByText('Skill Challenges')).toBeInTheDocument();
    expect(screen.getByText('10-Lesson Blues Challenge')).toBeInTheDocument();
    expect(screen.getByText('1 song')).toBeInTheDocument(); // challenge not counted as a song
  });

  it('search narrows the song catalog', () => {
    render(<RepertoireBrowser season={season([
      ep(1, 'Misty', 'tutorial'), ep(2, 'Autumn Leaves', 'tutorial'),
    ])} onPlay={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'mist' } });
    expect(screen.getByText('Misty')).toBeInTheDocument();
    expect(screen.queryByText('Autumn Leaves')).toBeNull();
  });

  it('facet chips filter the catalog', () => {
    render(<RepertoireBrowser season={season([
      ep(1, 'Misty', 'tutorial'),
      ep(2, 'Rocket Man', 'tutorial', { styles: ['Pop'] }),
    ])} onPlay={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pop' }));
    expect(screen.getByText('Rocket Man')).toBeInTheDocument();
    expect(screen.queryByText('Misty')).toBeNull();
  });
});
