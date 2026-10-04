import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LearnSegmentRail, { segmentNavigationState } from './LearnSegmentRail.jsx';

const segments = [
  { id: 'a', number: 1, label: 'Segment 1', name: 'Opening', barLabel: 'Bars 1–4', complete: false, testedOut: false },
  { id: 'b', number: 2, label: 'Segment 2', name: null, barLabel: 'Bars 5–8', complete: true, testedOut: false },
  { id: 'c', number: 3, label: 'Segment 3', name: 'Theme', barLabel: 'Bars 9–12', complete: true, testedOut: true },
];

describe('LearnSegmentRail', () => {
  it('stays out of the way until a score-native segment is selected', () => {
    render(<LearnSegmentRail segments={segmentNavigationState(segments, {})} onSelect={vi.fn()} />);
    expect(screen.queryByRole('navigation', { name: 'Selected segment' })).not.toBeInTheDocument();
  });

  it('sequential navigation locks only segments after the first incomplete one', () => {
    const projected = segmentNavigationState([
      { ...segments[0], complete: true }, { ...segments[1], complete: false }, { ...segments[2], complete: false },
    ], { sequential: true });
    expect(projected.map(({ id, locked, recommended }) => [id, locked, recommended])).toEqual([
      ['a', false, false], ['b', false, true], ['c', true, false],
    ]);
  });

  it('opens a compact selected-segment sheet with one primary action and separate Test out', () => {
    const onSelectRung = vi.fn();
    const selected = { ...segments[0], rungs: [
      { id: 'right', label: 'Right hand', state: 'current', passCount: 1, required: 6 },
      { id: 'left', label: 'Left hand', state: 'locked', passCount: 0, required: 6 },
      { id: 'test-out', label: 'Test out', state: 'available', passCount: 0, required: 3 },
    ] };
    render(<LearnSegmentRail segments={[selected]} selectedId="a" onSelectRung={onSelectRung} onClose={vi.fn()} />);
    expect(screen.getByText('Segment 1')).toBeInTheDocument();
    expect(screen.getByText('Opening · Bars 1–4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue Right hand' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Left hand/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Test out/ }));
    expect(onSelectRung).toHaveBeenCalledWith('test-out');
    fireEvent.click(screen.getByRole('button', { name: 'Show practice ladder' }));
    expect(screen.getByRole('button', { name: /Left hand/ })).toBeDisabled();
  });
});
