import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import FocusRangeLayer from './FocusRangeLayer.jsx';

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
