import { render } from '@testing-library/react';
import StaffDimLayer, { dimBands } from './StaffDimLayer.jsx';

const GRAND = [
  { system: 0, staff: 0, top: 100, left: 50, right: 550, lineSpacing: 10 },
  { system: 0, staff: 1, top: 200, left: 50, right: 550, lineSpacing: 10 },
  { system: 1, staff: 0, top: 400, left: 50, right: 550, lineSpacing: 10 },
  { system: 1, staff: 1, top: 500, left: 50, right: 550, lineSpacing: 10 },
];

describe('dimBands', () => {
  it('covers the dimmed staff from the inter-staff midpoint(s)', () => {
    const bands = dimBands(GRAND, [1]);
    // system 0: staff 1 band runs from midpoint(140, 200)=170 to bottom 240 + 15 pad
    expect(bands).toEqual([
      { left: 50, top: 170, width: 500, height: 255 - 170 },
      { left: 50, top: 470, width: 500, height: 555 - 470 },
    ]);
  });
  it('first staff pads upward instead of splitting', () => {
    const [band] = dimBands(GRAND.slice(0, 2), [0]);
    expect(band.top).toBe(100 - 15);            // top - 1.5*lineSpacing
    expect(band.top + band.height).toBe(170);   // midpoint to staff 1
  });
  it('empty inputs render nothing', () => {
    expect(dimBands([], [0])).toEqual([]);
    expect(dimBands(GRAND, [])).toEqual([]);
  });
});

it('renders one mask div per band', () => {
  const { container } = render(<StaffDimLayer staffBoxes={GRAND} dimmed={[1]} />);
  expect(container.querySelectorAll('.piano-score-staff-dim')).toHaveLength(2);
});
