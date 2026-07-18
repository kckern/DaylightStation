import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CaretLayer, MEASURE_START_UNITS } from './CaretLayer.jsx';

const steps = [{ notes: [{ x: 30, top: 10, bottom: 60, width: 12 }] }, { notes: [{ x: 80, top: 10, bottom: 60, width: 12 }] }];
const staves = [{ system: 0, top: 100, left: 20, right: 520, lineSpacing: 10 }];
const caretPos = (container) => {
  const c = container.querySelector('.composer-caret');
  const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(c.style.transform);
  return { x: Number(m[1]), top: Number(m[2]), height: c.style.height };
};

describe('CaretLayer', () => {
  it('renders a caret positioned at the target step', () => {
    const { container } = render(<CaretLayer steps={steps} caretStepIndex={1} scale={1} />);
    const caret = container.querySelector('.composer-caret');
    expect(caret).toBeTruthy();
    expect(caret.style.transform).toContain('80'); // step[1].x
  });
  it('parks past the last step when caret is at the open insertion point', () => {
    const { container } = render(<CaretLayer steps={steps} caretStepIndex={5} scale={1} />);
    const caret = container.querySelector('.composer-caret');
    expect(caret).toBeTruthy(); // parked, not crashed
  });
  // While wet ink is drying, `steps` is behind the model — the caret has to be
  // told where the wet layer actually painted.
  it('honours an override, ignoring the engraved step math', () => {
    const { container } = render(<CaretLayer steps={steps} caretStepIndex={0} scale={1} override={{ x: 240, top: 55, height: 44 }} />);
    const caret = container.querySelector('.composer-caret');
    expect(caret.style.transform).toContain('240px');
    expect(caret.style.transform).toContain('55px');
    expect(caret.style.height).toBe('44px');
  });
  it('renders an override even with no engraved steps (blank draft, first wet note)', () => {
    const { container } = render(<CaretLayer steps={[]} caretStepIndex={0} override={{ x: 120, top: 10, height: 40 }} />);
    expect(container.querySelector('.composer-caret')).toBeTruthy();
  });
  it('renders nothing when there are no steps', () => {
    const { container } = render(<CaretLayer steps={[]} caretStepIndex={0} scale={1} />);
    expect(container.querySelector('.composer-caret')).toBeNull();
  });
});

// The screen EVERY session starts on. buildSteps excludes rests and a blank
// draft is displayed as a whole-measure rest, so `steps` is empty here — the
// caret has to come from stave geometry or it does not exist at all.
describe('CaretLayer — blank staff', () => {
  it('positions at the measure entry point when nothing is engraved', () => {
    const { container } = render(<CaretLayer steps={[]} staves={staves} caretStepIndex={0} scale={1} />);
    expect(container.querySelector('.composer-caret')).toBeTruthy();
    const pos = caretPos(container);
    expect(pos.x).toBe(20 + 10 * MEASURE_START_UNITS); // past clef + time signature
    expect(pos.top).toBe(100);   // the staff's own top
    expect(pos.height).toBe('40px'); // 4 line spaces = the staff's height
  });

  it('still renders nothing with neither steps nor staves', () => {
    const { container } = render(<CaretLayer steps={[]} staves={[]} caretStepIndex={0} />);
    expect(container.querySelector('.composer-caret')).toBeNull();
  });

  it('prefers the engraved position over the blank-staff fallback', () => {
    const { container } = render(<CaretLayer steps={steps} staves={staves} caretStepIndex={1} scale={1} />);
    expect(caretPos(container).x).toBe(80); // step[1].x, not the stave entry point
  });

  it('prefers an override over the blank-staff fallback (first wet note on a blank draft)', () => {
    const { container } = render(
      <CaretLayer steps={[]} staves={staves} caretStepIndex={0} scale={1} override={{ x: 240, top: 55, height: 44 }} />
    );
    expect(caretPos(container).x).toBe(240);
  });

  it('falls back to the stave when the engraved step carries no note box', () => {
    // Degenerate layout: a step with no notes used to yield no caret at all.
    const { container } = render(<CaretLayer steps={[{ notes: [] }]} staves={staves} caretStepIndex={0} scale={1} />);
    expect(caretPos(container).x).toBe(20 + 10 * MEASURE_START_UNITS);
  });
});
