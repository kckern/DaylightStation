import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import FilterTimeline, { markAt, kindCounts } from './FilterTimeline.jsx';
import { previewStore } from './previewStore.js';

const CUES = [
  { id: 'a', in: 60, out: 61, effect: 'mute', label: 'd*mn', category: 'language/profanity/damn' },
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

  it('shapes a blackout without a scene as a blackout block too', () => {
    act(() => previewStore.publish({ cues: [{ id: 'r', in: 10, out: 20, effect: 'blackout' }], open: true }));
    const { container } = render(<FilterTimeline position={0} duration={100} />);
    expect(container.querySelector('.is-blackout')).toBeTruthy();
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

describe('FilterTimeline — pointing at the track', () => {
  beforeEach(() => { act(() => previewStore.reset()); vi.restoreAllMocks(); });
  const RECT = { left: 100, width: 400, top: 0, height: 40, right: 500, bottom: 40 };
  const at = (c) => { const bar = barOf(c); bar.getBoundingClientRect = () => RECT; return bar; };
  const xFor = (t) => RECT.left + (t / 1000) * RECT.width;

  it('a mark says what it is, what the viewer gets, when, and that a click jumps', () => {
    const c = setup(200, 1000);
    fireEvent.mouseMove(at(c), { clientX: xFor(60.5), clientY: 8 });
    const tip = screen.getByTestId('filter-timeline-tip');
    expect(tip.textContent).toMatch(/Muted/);
    expect(tip.textContent).toMatch(/Word/);
    expect(tip.textContent).toMatch(/d\*mn/);
    expect(tip.textContent).toMatch(/Language: profanity/);
    expect(tip.textContent).toMatch(/Sound is muted for this word/);
    expect(tip.textContent).toMatch(/1:00\.0 to 1:01\.0/);
    expect(tip.textContent).toMatch(/Click to jump here/);
    // The pointed-at mark is lifted; no bare hover time while on a mark.
    expect(c.container.querySelector('.filter-timeline__mark.is-hot')).toBeTruthy();
    expect(screen.queryByTestId('filter-timeline-hover-time')).toBeNull();
  });

  it('a scene reads as a scene, across all its pieces', () => {
    const c = setup(200, 1000);
    fireEvent.mouseMove(at(c), { clientX: xFor(315), clientY: 30 });
    const tip = screen.getByTestId('filter-timeline-tip');
    expect(tip.textContent).toMatch(/Scene/);
    expect(tip.textContent).toMatch(/Blurred/);
    expect(tip.textContent).toMatch(/5:00\.0 to 5:20\.0/);
    expect(c.container.querySelectorAll('.filter-timeline__mark.is-hot')).toHaveLength(2);
  });

  it('off a mark, shows the time under the pointer; leaving clears it', () => {
    const c = setup(200, 1000);
    const bar = at(c);
    fireEvent.mouseMove(bar, { clientX: xFor(750), clientY: 8 });
    expect(screen.queryByTestId('filter-timeline-tip')).toBeNull();
    expect(screen.getByTestId('filter-timeline-hover-time').textContent).toMatch(/^12:30/);
    fireEvent.mouseLeave(bar);
    expect(screen.queryByTestId('filter-timeline-hover-time')).toBeNull();
  });

  it('clicking the pointed-at mark selects it and jumps (with the lead), not a raw seek', () => {
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    const seek = vi.spyOn(previewStore, 'seekTo');
    const c = setup(200, 1000);
    const bar = at(c);
    fireEvent.mouseMove(bar, { clientX: xFor(316), clientY: 30 });
    fireEvent.click(bar, { clientX: xFor(316), clientY: 30 });
    expect(jump).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' })); // the scene's first piece
    expect(seek).not.toHaveBeenCalled();
    expect(previewStore.getSnapshot().selected).toMatchObject({ id: 'sc1', kind: 'scene' });
  });

  it('marks the selection from the store', () => {
    act(() => previewStore.publish({ selected: { id: 'b' } }));
    const c = setup(200, 1000);
    const sel = c.container.querySelectorAll('.filter-timeline__mark.is-selected');
    expect(sel).toHaveLength(1);
  });

  it('prefers the lane the pointer is in when marks share a time', () => {
    const cues = [{ id: 'w', in: 100, out: 101, effect: 'bleep' }, { id: 'v', in: 100, out: 104, effect: 'blur' }];
    expect(markAt(cues, 100.5, 1, 'sound').cue.id).toBe('w');
    expect(markAt(cues, 100.5, 1, 'picture').cue.id).toBe('v');
    expect(markAt(cues, 100.5, 1, 'picture').nearby).toBe(1);
    expect(markAt(cues, 200, 1, 'sound')).toBeNull();
  });
});

describe('FilterTimeline — legend, now, steps', () => {
  beforeEach(() => { act(() => previewStore.reset()); });

  it('explains every kind of mark with its count (a scene counts once)', () => {
    setup();
    const legend = screen.getByTestId('filter-timeline-legend');
    expect(legend.textContent).toMatch(/Words\s*2/);
    expect(legend.textContent).toMatch(/Blurred\s*1/);
    expect(legend.textContent).toMatch(/Hidden\s*1/);
    expect(legend.textContent).toMatch(/Skipped\s*1/);
    expect(kindCounts(CUES)).toEqual({ words: 2, picture: 1, hidden: 1, skipped: 1 });
  });

  it('counts units, not pieces: one tracked blur split per keyframe is one, a word and its remainders one', () => {
    const cues = [
      ...Array.from({ length: 9 }, (_, i) => ({ id: `va9#0@${i}`, in: 10 + i, out: 11 + i, effect: 'blur' })),
      { id: 'w1', in: 60, out: 60.4, effect: 'bleep', words: 1 },
      { id: 'w1#m0', in: 59.8, out: 60, effect: 'mute', toneRemainder: true, words: 0 },
      { id: 'sk#0', in: 500, out: 510, effect: 'skip' }, { id: 'sk#1', in: 510, out: 520, effect: 'skip' },
    ];
    expect(kindCounts(cues)).toEqual({ words: 1, picture: 1, hidden: 0, skipped: 1 });
  });

  it('labels the playhead with the current time and the bar with the running time', () => {
    const c = setup(754, 1000);
    expect(screen.getByTestId('filter-timeline-now').textContent).toBe('12:34');
    expect(c.container.querySelector('.filter-timeline__axis').textContent).toMatch(/16:40/);
  });

  it('previous / next say where they go', () => {
    setup(200);
    expect(screen.getByRole('button', { name: /next cue/i }).getAttribute('data-cf-hint')).toMatch(/at 5:00/);
    expect(screen.getByRole('button', { name: /previous cue/i }).getAttribute('data-cf-hint')).toMatch(/at 2:00/);
  });
});
