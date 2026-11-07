import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import FilterTimeline from './FilterTimeline.jsx';
import { previewStore } from './previewStore.js';

const CUES = [
  { id: 'a', in: 60, out: 61, effect: 'mute' },
  { id: 'b', in: 120, out: 121, effect: 'bleep' },
  { id: 's1', in: 300, out: 310, effect: 'blur', scene: 'sc1' },
  { id: 's2', in: 312, out: 320, effect: 'blur', scene: 'sc1' },
  { id: 'k', in: 400, out: 420, effect: 'blackout', scene: 'sc2' },
  { id: 'x', in: 500, out: 520, effect: 'skip-card', scene: 'sc3' },
];

function setup(position = 200, duration = 1000) {
  act(() => previewStore.publish({ cues: CUES, open: true }));
  return render(<FilterTimeline position={position} duration={duration} />);
}
const barOf = (c) => c.container.querySelector('.filter-timeline__bar');

describe('FilterTimeline', () => {
  beforeEach(() => { act(() => previewStore.reset()); vi.restoreAllMocks(); });

  it('renders marks at left = in/duration percent, with kind classes', () => {
    const { container } = setup();
    const marks = container.querySelectorAll('[data-testid="filter-timeline-mark"]');
    expect(marks).toHaveLength(CUES.length);
    expect(marks[0].style.left).toBe('6%');
    expect(marks[0].className).toMatch(/is-tick/);
    expect(marks[2].className).toMatch(/is-bar/);
    expect(container.querySelector('.is-blackout')).toBeTruthy();
    expect(container.querySelector('.is-skip')).toBeTruthy();
  });

  it('places the playhead at position/duration', () => {
    const { container } = setup(250, 1000);
    expect(container.querySelector('.filter-timeline__playhead').style.left).toBe('25%');
  });

  it('click on the bar seeks to x% * duration', () => {
    const seek = vi.spyOn(previewStore, 'seekTo');
    const c = setup();
    const bar = barOf(c);
    bar.getBoundingClientRect = () => ({ left: 100, width: 400, top: 0, height: 10, right: 500, bottom: 10 });
    fireEvent.click(bar, { clientX: 300 });
    expect(seek).toHaveBeenCalledWith(500);
  });

  it('guards duration 0: no marks, click does nothing', () => {
    const seek = vi.spyOn(previewStore, 'seekTo');
    const c = setup(0, 0);
    expect(c.container.querySelectorAll('[data-testid="filter-timeline-mark"]')).toHaveLength(0);
    fireEvent.click(barOf(c), { clientX: 10 });
    expect(seek).not.toHaveBeenCalled();
  });

  it('prev/next step cues, a scene being one stop', () => {
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    setup(200);
    fireEvent.click(screen.getByRole('button', { name: /next cue/i }));
    expect(jump).toHaveBeenLastCalledWith(expect.objectContaining({ id: 's1' }));
    fireEvent.click(screen.getByRole('button', { name: /previous cue/i }));
    expect(jump).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }));
  });

  it('next from where a jump landed (in - lead) moves on, not back to the same stop', () => {
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    setup(300 - 4); // where jumpToCue(s1) leaves the playhead
    fireEvent.click(screen.getByRole('button', { name: /next cue/i }));
    expect(jump).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'k' }));
  });

  it('disables buttons at the ends', () => {
    setup(0);
    expect(screen.getByRole('button', { name: /previous cue/i }).disabled).toBe(true);
  });
});
