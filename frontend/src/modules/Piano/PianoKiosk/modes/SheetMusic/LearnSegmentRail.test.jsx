import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LearnSegmentRail, { segmentNavigationState } from './LearnSegmentRail.jsx';

const segments = [
  { id: 'a', number: 1, label: 'Segment 1', name: 'Opening', barLabel: 'Bars 1–4', complete: false, testedOut: false },
  { id: 'b', number: 2, label: 'Segment 2', name: null, barLabel: 'Bars 5–8', complete: true, testedOut: false },
  { id: 'c', number: 3, label: 'Segment 3', name: 'Theme', barLabel: 'Bars 9–12', complete: true, testedOut: true },
];

describe('LearnSegmentRail', () => {
  it('shows numbered segments first, bar ranges second, and optional authored names', () => {
    render(<LearnSegmentRail segments={segmentNavigationState(segments, {})} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Segment 1, Opening, Bars 1–4, Next/ })).toBeInTheDocument();
    expect(screen.getByText('Segment 1')).toBeInTheDocument();
    expect(screen.getByText('Opening')).toBeInTheDocument();
    expect(screen.getByText('Bars 1–4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Segment 3, Theme, Bars 9–12, Tested out/ })).toHaveAttribute('data-state', 'tested-out');
  });

  it('selects every segment in open navigation and disables only explicit locks', () => {
    const onSelect = vi.fn();
    const projected = segmentNavigationState(segments, { sequential: false });
    render(<LearnSegmentRail segments={projected} onSelect={onSelect} />);
    for (const number of [1, 2, 3]) fireEvent.click(screen.getByRole('button', { name: new RegExp(`Segment ${number}`) }));
    expect(onSelect.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c']);
  });

  it('sequential navigation locks only segments after the first incomplete one', () => {
    const projected = segmentNavigationState([
      { ...segments[0], complete: true }, { ...segments[1], complete: false }, { ...segments[2], complete: false },
    ], { sequential: true });
    expect(projected.map(({ id, locked, recommended }) => [id, locked, recommended])).toEqual([
      ['a', false, false], ['b', false, true], ['c', true, false],
    ]);
  });

  it('collapses without removing the score-native navigation contract', () => {
    render(<LearnSegmentRail segments={segments} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse segment rail' }));
    expect(screen.queryByText('Bars 1–4')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand segment rail' })).toBeInTheDocument();
  });

  it('opens the selected segment ladder and keeps Test Out available', () => {
    const onSelectRung = vi.fn();
    const selected = { ...segments[0], rungs: [
      { id: 'right', label: 'Right hand', state: 'current', passCount: 1, required: 6 },
      { id: 'left', label: 'Left hand', state: 'locked', passCount: 0, required: 6 },
      { id: 'test-out', label: 'Test out', state: 'available', passCount: 0, required: 3 },
    ] };
    render(<LearnSegmentRail segments={[selected]} selectedId="a" onSelectRung={onSelectRung} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Right hand/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Left hand/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Test out/ }));
    expect(onSelectRung).toHaveBeenCalledWith('test-out');
  });
});
