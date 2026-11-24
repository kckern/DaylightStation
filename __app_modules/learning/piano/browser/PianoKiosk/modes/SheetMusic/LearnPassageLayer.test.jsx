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
    expect(marker).toHaveTextContent('1');
    expect(marker).not.toHaveTextContent('✓');
    expect(marker).not.toHaveTextContent('Mastered');
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
    const next = screen.getByRole('button', { name: /Segment 1.*Next/ });
    const work = screen.getByRole('button', { name: /Segment 2.*In progress/ });
    const tested = screen.getByRole('button', { name: /Segment 3.*Tested out/ });
    const locked = screen.getByRole('button', { name: /Segment 4.*Locked/ });
    expect(next).toHaveAttribute('data-state', 'next');
    expect(work).toHaveAttribute('data-state', 'in-progress');
    expect(tested).toHaveAttribute('data-state', 'tested-out');
    expect(locked).toBeDisabled();
    expect([next, work, tested, locked].map((marker) => marker.textContent)).toEqual(['1', '2', '3', '4']);
    for (const marker of [next, work, tested, locked]) {
      expect(marker).not.toHaveTextContent(/Next|progress|Tested|Locked/);
    }
  });

  it('uses engraved barlines but hugs the selected notation vertically', () => {
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
    expect(outlines[0].style.top).toBe('81px');
    expect(outlines[0].style.height).toBe('7px');
  });

  it("a badge that would cross the page view's edge is not drawn", () => {
    // Three passages on three systems; the page view shows the engraving from 150 to 520.
    const measures = [0, 1, 2].map((index) => ({ firstStep: index, lastStep: index }));
    const stepBoxes = [0, 1, 2].map((index) => ({ x: 40, top: 100 + index * 200, bottom: 180 + index * 200 }));
    const passages = ['A', 'B', 'C'].map((letter, index) => ({ id: letter, number: letter, label: `Passage ${letter}`, inMeasure: index, outMeasure: index }));
    // A is cut at the top (100-140 against 150), B is whole (300-340), C is cut at the bottom (500-540 against 520).
    const numbers = [0, 1, 2].map((index) => ({ id: passages[index].id, left: 44, top: 100 + index * 200, anchor: 154 + index * 200 }));
    const { rerender } = render(<LearnPassageLayer passages={passages} measures={measures} stepBoxes={stepBoxes} numbers={numbers} view={{ top: 150, bottom: 520 }} />);
    expect(screen.queryByRole('button', { name: /Passage A/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Passage B/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Passage C/ })).toBeNull();
    // A badge exactly on the edge is whole; no view (not paged yet) draws them all.
    rerender(<LearnPassageLayer passages={passages} measures={measures} stepBoxes={stepBoxes} numbers={numbers} view={{ top: 100, bottom: 540 }} />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
    rerender(<LearnPassageLayer passages={passages} measures={measures} stepBoxes={stepBoxes} numbers={numbers} />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('keeps the segment marker clear above the selected passage bracket', () => {
    const { container } = render(<LearnPassageLayer
      passages={[{ id: 'a', number: 1, label: 'Segment 1', inMeasure: 0, outMeasure: 0 }]}
      measures={[{ firstStep: 0, lastStep: 0 }]}
      stepBoxes={[{ x: 30, top: 100, bottom: 180 }]}
      measureRects={[{ left: 10, right: 100, top: 70, bottom: 230, system: 0 }]}
      selectedId="a"
    />);
    const marker = screen.getByRole('button', { name: /Segment 1/ });
    const bracket = container.querySelector('.piano-learn-selection-bracket');
    const markerBottom = Number.parseFloat(marker.style.top) + 40;
    expect(markerBottom).toBeLessThanOrEqual(Number.parseFloat(bracket.style.top) - 6);
  });

  it('draws separate tight outlines when a selected segment wraps systems', () => {
    const measures = [
      { firstStep: 0, lastStep: 0 },
      { firstStep: 1, lastStep: 1 },
    ];
    const stepBoxes = [
      { x: 170, top: 100, bottom: 180 },
      { x: 40, top: 360, bottom: 440 },
    ];
    const measureRects = [
      { left: 120, right: 220, top: 60, bottom: 300, system: 0 },
      { left: 20, right: 110, top: 320, bottom: 560, system: 1 },
    ];
    const { container } = render(<LearnPassageLayer
      passages={[]}
      measures={measures}
      stepBoxes={stepBoxes}
      measureRects={measureRects}
      selectedRange={{ inMeasure: 0, outMeasure: 1 }}
    />);
    const outlines = [...container.querySelectorAll('.piano-learn-selection-outline')];
    expect(outlines).toHaveLength(2);
    expect(outlines.map((outline) => ({ top: outline.style.top, height: outline.style.height }))).toEqual([
      { top: '81px', height: '7px' },
      { top: '341px', height: '7px' },
    ]);
  });

  it('makes every engraved band in a wrapped segment a selectable hotspot', () => {
    const onSelect = vi.fn();
    const { container } = render(<LearnPassageLayer
      passages={[{ id: 'a', number: 1, label: 'Segment 1', barLabel: 'Bars 1–2', inMeasure: 0, outMeasure: 1 }]}
      measures={[{ firstStep: 0, lastStep: 0 }, { firstStep: 1, lastStep: 1 }]}
      stepBoxes={[{ x: 170, top: 100, bottom: 180 }, { x: 40, top: 360, bottom: 440 }]}
      measureRects={[
        { left: 120, right: 220, top: 60, bottom: 300, system: 0 },
        { left: 20, right: 110, top: 320, bottom: 560, system: 1 },
      ]}
      onSelect={onSelect}
    />);
    const hotspots = [...container.querySelectorAll('.piano-learn-passage-hitbox')];
    expect(hotspots).toHaveLength(2);
    expect(hotspots.map((hotspot) => [hotspot.style.left, hotspot.style.width])).toEqual([
      ['120px', '100px'], ['20px', '90px'],
    ]);
    fireEvent.click(hotspots[1]);
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('keeps wrapped outlines separate while engraved barlines are still loading', () => {
    const measures = [
      { firstStep: 0, lastStep: 0 },
      { firstStep: 1, lastStep: 1 },
    ];
    const stepBoxes = [
      { x: 170, top: 100, bottom: 180 },
      { x: 40, top: 360, bottom: 440 },
    ];
    const { container } = render(<LearnPassageLayer
      passages={[]}
      measures={measures}
      stepBoxes={stepBoxes}
      selectedRange={{ inMeasure: 0, outMeasure: 1 }}
    />);
    const outlines = [...container.querySelectorAll('.piano-learn-selection-outline')];
    expect(outlines.map((outline) => ({ top: outline.style.top, height: outline.style.height }))).toEqual([
      { top: '81px', height: '7px' },
      { top: '341px', height: '7px' },
    ]);
  });

  it('detects a fallback wrap from its vertical system even when x increases', () => {
    const measures = [{ firstStep: 0, lastStep: 0 }, { firstStep: 1, lastStep: 1 }];
    const stepBoxes = [
      { x: 40, top: 100, bottom: 180 },
      { x: 60, top: 360, bottom: 440 },
    ];
    const { container } = render(<LearnPassageLayer passages={[]} measures={measures} stepBoxes={stepBoxes}
      selectedRange={{ inMeasure: 0, outMeasure: 1 }} />);
    expect(container.querySelectorAll('.piano-learn-selection-outline')).toHaveLength(2);
  });

  it('preserves available engraved barlines while neighboring rectangles are still loading', () => {
    const measures = [{ firstStep: 0, lastStep: 0 }, { firstStep: 1, lastStep: 1 }];
    const stepBoxes = [
      { x: 40, top: 100, bottom: 180 },
      { x: 150, top: 100, bottom: 180 },
    ];
    const measureRects = [{ left: 10, right: 100, top: 70, bottom: 230, system: 0 }];
    const { container } = render(<LearnPassageLayer passages={[]} measures={measures} stepBoxes={stepBoxes}
      measureRects={measureRects} selectedRange={{ inMeasure: 0, outMeasure: 1 }} />);
    const outline = container.querySelector('.piano-learn-selection-outline');
    expect(outline.style.left).toBe('10px');
    expect(Number.parseFloat(outline.style.width)).toBeGreaterThan(140);
  });
});
