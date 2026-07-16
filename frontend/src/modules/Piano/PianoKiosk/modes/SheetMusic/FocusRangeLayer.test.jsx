import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import FocusRangeLayer, { rangeBands } from './FocusRangeLayer.jsx';

const measures = [
  { index: 0, firstStep: 0, lastStep: 1 },
  { index: 1, firstStep: 2, lastStep: 3 },
  { index: 2, firstStep: 4, lastStep: 5 },
];
const stepBoxes = [
  { x: 10, top: 0, bottom: 100 }, { x: 30, top: 0, bottom: 100 },
  { x: 50, top: 0, bottom: 100 }, { x: 70, top: 0, bottom: 100 },
  { x: 90, top: 0, bottom: 100 }, { x: 110, top: 0, bottom: 100 },
];

describe('FocusRangeLayer', () => {
  it('renders a tint band and two bracket edges for a range', () => {
    const { container } = render(
      <FocusRangeLayer measures={measures} stepBoxes={stepBoxes} range={{ inMeasure: 1, outMeasure: 2 }} />,
    );
    expect(container.querySelector('.piano-score-range-tint')).not.toBeNull();
    expect(container.querySelectorAll('.piano-score-range-bracket')).toHaveLength(2);
  });

  it('renders a single pending bracket while selecting the first measure', () => {
    const { container } = render(
      <FocusRangeLayer measures={measures} stepBoxes={stepBoxes} pending={1} />,
    );
    expect(container.querySelectorAll('.piano-score-range-bracket--pending')).toHaveLength(1);
    expect(container.querySelector('.piano-score-range-tint')).toBeNull(); // no full range yet
  });

  it('renders nothing without a range or pending', () => {
    const { container } = render(<FocusRangeLayer measures={measures} stepBoxes={stepBoxes} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('FocusRangeLayer — multi-system ranges (audit L4)', () => {
  // Two systems in wrapped flow: steps 0-3 on system 1 (top 0), steps 4-5 on
  // system 2 (top 200). A new system is detected by the x reset (160 → 10).
  const measures = [
    { index: 0, firstStep: 0, lastStep: 1 },
    { index: 1, firstStep: 2, lastStep: 3 },
    { index: 2, firstStep: 4, lastStep: 5 },
  ];
  const boxes = [
    { x: 10, top: 0, bottom: 100 }, { x: 60, top: 0, bottom: 100 },
    { x: 110, top: 0, bottom: 100 }, { x: 160, top: 0, bottom: 100 },
    { x: 10, top: 200, bottom: 300 }, { x: 60, top: 200, bottom: 300 },
  ];

  it('draws one tint band per system for a range crossing a line break', () => {
    const { container } = render(
      <FocusRangeLayer measures={measures} stepBoxes={boxes} range={{ inMeasure: 1, outMeasure: 2 }} />,
    );
    const tints = [...container.querySelectorAll('.piano-score-range-tint')];
    expect(tints).toHaveLength(2);
    // Band 1: measure 1 on system 1 (x 110–160, top 0).
    expect(tints[0].style.left).toBe('110px');
    expect(tints[0].style.top).toBe('0px');
    // Band 2: measure 2 on system 2 (x from 10, top 200) — NOT a rect spanning both systems.
    expect(tints[1].style.left).toBe('10px');
    expect(tints[1].style.top).toBe('200px');
  });

  it('rangeBands: single-system range yields one band', () => {
    expect(rangeBands(measures, boxes, { inMeasure: 0, outMeasure: 1 })).toHaveLength(1);
  });
});
