import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import MeasureGradeLayer from './MeasureGradeLayer.jsx';

const measures = [
  { index: 0, firstStep: 0, lastStep: 1 },
  { index: 1, firstStep: 2, lastStep: 3 },
];
const stepBoxes = [
  { x: 10, top: 5, bottom: 100 },
  { x: 50, top: 5, bottom: 100 },
  { x: 90, top: 8, bottom: 120 },
  { x: 130, top: 8, bottom: 120 },
];

describe('MeasureGradeLayer', () => {
  it('renders one colored rect per graded measure', () => {
    const { container } = render(
      <MeasureGradeLayer measures={measures} stepBoxes={stepBoxes} grades={{ 0: { grade: 'green' } }} />,
    );
    expect(container.querySelectorAll('.piano-score-measure-grade').length).toBe(1);
    expect(container.querySelector('.piano-score-measure-grade--green')).toBeTruthy();
  });

  it('omits measures with no grade', () => {
    const { container } = render(
      <MeasureGradeLayer measures={measures} stepBoxes={stepBoxes} grades={{}} />,
    );
    expect(container.querySelectorAll('.piano-score-measure-grade').length).toBe(0);
  });

  it('positions the rect spanning the measure steps', () => {
    const { container } = render(
      <MeasureGradeLayer measures={measures} stepBoxes={stepBoxes} grades={{ 1: { grade: 'red' } }} />,
    );
    const rect = container.querySelector('.piano-score-measure-grade--red');
    expect(rect).toBeTruthy();
    expect(rect.style.left).toBe('90px');   // first step (x=90)
    expect(rect.style.width).toBe('40px');  // last step x=130 − first x=90
    expect(rect.style.top).toBe('8px');
    expect(rect.style.height).toBe('112px'); // bottom 120 − top 8
  });

  it('skips measures whose step geometry is missing', () => {
    const { container } = render(
      <MeasureGradeLayer measures={[{ index: 0, firstStep: 9, lastStep: 9 }]} stepBoxes={stepBoxes} grades={{ 0: { grade: 'green' } }} />,
    );
    expect(container.querySelectorAll('.piano-score-measure-grade').length).toBe(0);
  });
});
