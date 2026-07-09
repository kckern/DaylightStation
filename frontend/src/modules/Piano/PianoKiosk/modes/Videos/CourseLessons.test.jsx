import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CourseLessons from './CourseLessons.jsx';

const ep = (i, title, extra = {}) => ({ plex: String(i), id: `plex:${i}`, itemIndex: i, label: title, ...extra });

describe('CourseLessons', () => {
  it('renders every lesson', () => {
    render(<CourseLessons lessons={[ep(101, 'A'), ep(102, 'B')]} onPlay={vi.fn()} />);
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByText('B')).toBeTruthy();
  });

  it('gates: locks lessons after the first unwatched, plays an open one', () => {
    const onPlay = vi.fn();
    render(<CourseLessons onPlay={onPlay} lessons={[
      ep(101, 'A', { userWatched: true }),
      ep(102, 'B', { userWatched: false }),
      ep(103, 'C', { userWatched: false }),
    ]} />);
    const bBtn = screen.getByText('B').closest('button');
    const cBtn = screen.getByText('C').closest('button');
    expect(bBtn.className).toContain('piano-episode--current');
    expect(cBtn.disabled).toBe(true);
    fireEvent.click(cBtn);
    expect(onPlay).not.toHaveBeenCalled();
    fireEvent.click(bBtn);
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ plex: '102' }));
  });

  it('sequential=false leaves all lessons open', () => {
    const onPlay = vi.fn();
    render(<CourseLessons sequential={false} onPlay={onPlay} lessons={[
      ep(101, 'A', { userWatched: false }), ep(102, 'B', { userWatched: false }),
    ]} />);
    fireEvent.click(screen.getByText('B').closest('button'));
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ plex: '102' }));
  });
});
