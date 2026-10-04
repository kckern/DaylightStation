import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import LearnPassageLayer from './LearnPassageLayer.jsx';

describe('LearnPassageLayer', () => {
  it('turns engraved passage geometry into selectable roadmap regions', () => {
    const onSelect = vi.fn();
    const measures = [
      { firstStep: 0, lastStep: 0 },
      { firstStep: 1, lastStep: 1 },
    ];
    const stepBoxes = [
      { x: 20, top: 10, bottom: 100 },
      { x: 80, top: 10, bottom: 100 },
    ];
    render(<LearnPassageLayer passages={[{ id: 'm0-1', order: 1, label: 'Bars 1–2', inMeasure: 0, outMeasure: 1, complete: true }]} measures={measures} stepBoxes={stepBoxes} onSelect={onSelect} />);
    const region = screen.getByRole('button', { name: 'Bars 1–2, complete' });
    expect(region).toHaveAttribute('data-state', 'complete');
    fireEvent.click(region);
    expect(onSelect).toHaveBeenCalledWith('m0-1');
  });
});
