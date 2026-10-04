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
    render(<LearnPassageLayer passages={[{ id: 'm0-1', number: 1, label: 'Segment 1', barLabel: 'Bars 1–2', name: 'Theme', inMeasure: 0, outMeasure: 1, complete: true }]} measures={measures} stepBoxes={stepBoxes} onSelect={onSelect} />);
    const marker = screen.getByRole('button', { name: 'Segment 1, Theme, Bars 1–2, Mastered' });
    expect(marker).toHaveAttribute('data-state', 'mastered');
    expect(marker.style.width).toBe('');
    expect(document.querySelector('.piano-learn-selection-outline')).toBeNull();
    fireEvent.click(marker);
    expect(onSelect).toHaveBeenCalledWith('m0-1');
  });

  it('exposes Next, in-progress, tested-out, and locked states without relying on color', () => {
    const measures = Array.from({ length: 4 }, (_, index) => ({ firstStep: index, lastStep: index }));
    const stepBoxes = measures.map((_, index) => ({ x: 20 + index * 60, top: 10, bottom: 100 }));
    render(<LearnPassageLayer
      passages={[
        { id: 'next', number: 1, label: 'Segment 1', barLabel: 'Bars 1–1', inMeasure: 0, outMeasure: 0, recommended: true },
        { id: 'work', number: 2, label: 'Segment 2', barLabel: 'Bars 2–2', inMeasure: 1, outMeasure: 1, inProgress: true },
        { id: 'test', number: 3, label: 'Segment 3', barLabel: 'Bars 3–3', inMeasure: 2, outMeasure: 2, testedOut: true },
        { id: 'lock', number: 4, label: 'Segment 4', barLabel: 'Bars 4–4', inMeasure: 3, outMeasure: 3, locked: true },
      ]}
      measures={measures} stepBoxes={stepBoxes} onSelect={vi.fn()}
    />);
    expect(screen.getByRole('button', { name: /Segment 1.*Next/ })).toHaveAttribute('data-state', 'next');
    expect(screen.getByRole('button', { name: /Segment 2.*In progress/ })).toHaveAttribute('data-state', 'in-progress');
    expect(screen.getByRole('button', { name: /Segment 3.*Tested out/ })).toHaveAttribute('data-state', 'tested-out');
    expect(screen.getByRole('button', { name: /Segment 4.*Locked/ })).toBeDisabled();
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
