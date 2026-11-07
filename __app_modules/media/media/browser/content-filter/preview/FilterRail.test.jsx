import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import FilterRail from './FilterRail.jsx';
import { previewStore } from './previewStore.js';

const CUES = [
  { id: 'a', in: 10, out: 11, effect: 'mute', label: 'word a' },
  { id: 's1', in: 100, out: 110, effect: 'blur', label: 'fight', scene: 'sc1' },
  { id: 's2', in: 112, out: 120, effect: 'blur', label: 'fight', scene: 'sc1' },
  { id: 'b', in: 200, out: 201, effect: 'bleep', label: 'word b' },
];

function setup(partial = {}, position = 50) {
  act(() => previewStore.publish({
    cues: CUES, scenes: [{ id: 'sc1', label: 'Fight scene' }],
    certification: { level: 'parent' }, summary: '3 words muted', open: true, ...partial,
  }));
  return render(<FilterRail position={position} duration={600} />);
}

describe('FilterRail', () => {
  beforeEach(() => { act(() => previewStore.reset()); });

  it('shows certification level and summary; close calls close()', () => {
    const spy = vi.spyOn(previewStore, 'close');
    setup();
    expect(screen.getByText('parent')).toBeTruthy();
    expect(screen.getByText('3 words muted')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(spy).toHaveBeenCalled();
  });

  it('shows the last fired item and replays it', () => {
    const spy = vi.spyOn(previewStore, 'replayLast');
    setup({ lastFired: { id: 'a', label: 'word a', effect: 'mute', in: 10 } });
    expect(screen.getByText('word a')).toBeTruthy();
    expect(screen.getByText('muted')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /replay last/i }));
    expect(spy).toHaveBeenCalled();
  });

  it('lists upcoming items once per scene with seconds away; click jumps and selects', () => {
    const jump = vi.spyOn(previewStore, 'jumpToCue');
    setup();
    const rows = screen.getAllByTestId('filter-rail-next');
    expect(rows).toHaveLength(2); // scene sc1 once, then b
    expect(rows[0].textContent).toMatch(/50s/);
    fireEvent.click(rows[0]);
    expect(jump).toHaveBeenCalledWith(expect.objectContaining({ in: 100 }));
    expect(previewStore.getSnapshot().selected).toMatchObject({ id: 'sc1' });
  });

  it('limits Next to 5 and skips items already past', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, in: 100 + i, out: 101 + i, effect: 'mute', label: `c${i}` }));
    setup({ cues: [{ id: 'old', in: 1, out: 2, effect: 'mute', label: 'old' }, ...many] });
    expect(screen.getAllByTestId('filter-rail-next')).toHaveLength(5);
    expect(screen.queryByText('old')).toBeNull();
  });

  it('peeks unfiltered on the selected item', () => {
    const peek = vi.spyOn(previewStore, 'peek');
    setup();
    fireEvent.click(screen.getAllByTestId('filter-rail-next')[1]);
    fireEvent.click(screen.getByRole('button', { name: /peek unfiltered/i }));
    expect(peek).toHaveBeenCalledWith('b');
  });

  it('labels a scene piece with no label as "Scene" + effect word', () => {
    setup({ lastFired: { id: 's1', effect: 'blur', in: 100, scene: 'sc1' } });
    expect(screen.getAllByText('Scene blurred').length).toBeGreaterThan(0);
  });
});

describe('FilterRail tabs', () => {
  beforeEach(() => { act(() => previewStore.reset()); });
  it('switches between Review and Settings', () => {
    setup({ ratingKey: '77' });
    expect(screen.queryByTestId('settings-panel')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(screen.getByTestId('settings-panel')).toBeTruthy();
    expect(screen.queryByText('Last')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    expect(screen.getByText('Last')).toBeTruthy();
  });
});
