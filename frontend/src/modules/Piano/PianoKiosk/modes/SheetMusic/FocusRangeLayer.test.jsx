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
  it('renders a tint band for a range — and no brackets (the handles own the ends)', () => {
    const { container } = render(
      <FocusRangeLayer measures={measures} stepBoxes={stepBoxes} range={{ inMeasure: 1, outMeasure: 2 }} />,
    );
    expect(container.querySelector('.piano-score-range-tint')).not.toBeNull();
    // Since wave-3 F the boundary visual IS the draggable handle (RangeHandleLayer):
    // a second, undraggable bracket at the same x would be a decoy target.
    expect(container.querySelectorAll('.piano-score-range-bracket')).toHaveLength(0);
  });

  it('renders nothing without a range', () => {
    const { container } = render(<FocusRangeLayer measures={measures} stepBoxes={stepBoxes} />);
    expect(container.firstChild).toBeNull();
  });

  it('ticks each section mark at that measure’s left edge', () => {
    const { container } = render(
      <FocusRangeLayer measures={measures} stepBoxes={stepBoxes} range={{ inMeasure: 0, outMeasure: 2 }} marks={[0, 2]} />,
    );
    const ticks = [...container.querySelectorAll('.piano-score-section-mark')];
    expect(ticks).toHaveLength(2);
    expect(ticks[0].style.left).toBe('8px');   // measure 0 starts at x 10
    expect(ticks[1].style.left).toBe('88px');  // measure 2 starts at x 90
    expect(ticks[0].style.height).toBe('100px');
  });

  it('draws marks even with no range yet — they are what a first endpoint snaps to', () => {
    const { container } = render(
      <FocusRangeLayer measures={measures} stepBoxes={stepBoxes} marks={[1]} />,
    );
    expect(container.querySelectorAll('.piano-score-section-mark')).toHaveLength(1);
    expect(container.querySelector('.piano-score-range-tint')).toBeNull();
  });

  it('skips a mark the engraving has no measure for', () => {
    const { container } = render(
      <FocusRangeLayer measures={measures} stepBoxes={stepBoxes} marks={[1, 99]} />,
    );
    expect(container.querySelectorAll('.piano-score-section-mark')).toHaveLength(1);
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
    // Band 1: measure 1 on system 1 (notes at x 110–160, top 0). Its left edge
    // reaches BACK past the first note — midway to the previous one at x 60 —
    // so the notehead sits inside the band instead of being cut in half.
    expect(tints[0].style.left).toBe('85px');
    expect(tints[0].style.top).toBe('0px');
    // Band 2: measure 2 on system 2 (x from 10, top 200) — NOT a rect spanning both systems.
    expect(tints[1].style.left).toBe('10px');
    expect(tints[1].style.top).toBe('200px');
  });

  it('rangeBands: single-system range yields one band', () => {
    expect(rangeBands(measures, boxes, { inMeasure: 0, outMeasure: 1 })).toHaveLength(1);
  });
});

describe('rangeBands — the band lands between notes, never through them', () => {
  // Evenly spaced notes, 20px apart, one measure per two steps.
  const BOXES = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 100 + i * 20, top: 10, bottom: 40 }));
  const MEAS = [
    { index: 0, firstStep: 0, lastStep: 1 },
    { index: 1, firstStep: 2, lastStep: 3 },
    { index: 2, firstStep: 4, lastStep: 5 },
  ];

  it('reaches back past the first note and forward past the last', () => {
    // Measure 1 spans notes at x=140 and x=160. Anchoring the band on those
    // centres cut both noteheads in half. It now stops midway to the neighbours
    // either side — where the barline is — so whole notes sit inside it.
    const [band] = rangeBands(MEAS, BOXES, { inMeasure: 1, outMeasure: 1 });
    expect(band.left).toBe(130);  // midway back to the previous note at 120
    expect(band.right).toBe(170); // midway on to the next note at 180
  });

  it('still contains every note of a multi-measure range', () => {
    const [band] = rangeBands(MEAS, BOXES, { inMeasure: 0, outMeasure: 1 });
    expect(band.left).toBeLessThan(100);  // before the very first note
    expect(band.right).toBe(170);
  });

  it('pads the outer edge when the range runs to the end of the music', () => {
    // No neighbour to measure against — the band must still clear the last note
    // rather than stopping dead on its centre.
    const [band] = rangeBands(MEAS, BOXES, { inMeasure: 2, outMeasure: 2 });
    expect(band.right).toBeGreaterThan(200);
  });
});
