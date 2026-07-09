import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LessonList from './LessonList.jsx';

const ep = (i, title, extra = {}) => ({ plex: String(i), id: `plex:${i}`, itemIndex: i, label: title, duration: 500, image: `/t${i}.jpg`, ...extra });

describe('LessonList', () => {
  it('renders lessons with their thumbnail', () => {
    const { container } = render(<LessonList lessons={[ep(101, 'Pop Chords')]} onPlay={vi.fn()} />);
    expect(container.querySelector('.piano-episode__thumb img')).toBeTruthy();
    expect(screen.getByText('Pop Chords')).toBeTruthy();
  });
  it('gates: locks after the first unwatched, gives it the Play button', () => {
    const onPlay = vi.fn();
    render(<LessonList onPlay={onPlay} lessons={[
      ep(101, 'A', { userWatched: true }), ep(102, 'B', { userWatched: false }), ep(103, 'C', { userWatched: false }),
    ]} />);
    const b = screen.getByText('B').closest('button');
    const c = screen.getByText('C').closest('button');
    expect(b.className).toContain('is-current');
    expect(c.disabled).toBe(true);
    fireEvent.click(c); expect(onPlay).not.toHaveBeenCalled();
    fireEvent.click(b); expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ plex: '102' }));
  });
  it('reference course never gates (all open)', () => {
    const onPlay = vi.fn();
    render(<LessonList reference onPlay={onPlay} lessons={[ep(101, 'X', { userWatched: false }), ep(102, 'Y', { userWatched: false })]} />);
    fireEvent.click(screen.getByText('Y').closest('button'));
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ plex: '102' }));
  });
});
