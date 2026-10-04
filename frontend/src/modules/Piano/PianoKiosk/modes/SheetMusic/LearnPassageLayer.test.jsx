import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import LearnPassageLayer from './LearnPassageLayer.jsx';

describe('LearnPassageLayer', () => {
  it('shows start markers without covering every passage', () => {
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
    const marker = screen.getByRole('button', { name: 'Bars 1–2, complete' });
    expect(marker).toHaveAttribute('data-state', 'complete');
    expect(marker.style.width).toBe('');
    expect(document.querySelector('.piano-learn-selection-outline')).toBeNull();
    fireEvent.click(marker);
    expect(onSelect).toHaveBeenCalledWith('m0-1');
  });

  it('outlines only the selected full-bar range, including out-of-staff notes', () => {
    const measures = [
      { firstStep: 0, lastStep: 0 },
      { firstStep: 1, lastStep: 1 },
    ];
    const stepBoxes = [
      { x: 30, top: 100, bottom: 180 },
      { x: 130, top: 100, bottom: 180 },
    ];
    const measureRects = [
      { left: 10, right: 100, top: 70, bottom: 230, system: 0 },
      { left: 100, right: 200, top: 70, bottom: 230, system: 0 },
    ];
    const { container } = render(<LearnPassageLayer
      passages={[{ id: 'a', order: 1, label: 'Bar 1', inMeasure: 0, outMeasure: 0 }, { id: 'b', order: 2, label: 'Bar 2', inMeasure: 1, outMeasure: 1 }]}
      measures={measures}
      stepBoxes={stepBoxes}
      measureRects={measureRects}
      selectedRange={{ inMeasure: 1, outMeasure: 1 }}
      onSelect={vi.fn()}
    />);
    const outlines = container.querySelectorAll('.piano-learn-selection-outline');
    expect(outlines).toHaveLength(1);
    expect(outlines[0].style.left).toBe('100px');
    expect(outlines[0].style.width).toBe('100px');
    expect(outlines[0].style.top).toBe('70px');
    expect(outlines[0].style.height).toBe('160px');
  });
});
