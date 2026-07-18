import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CaretLayer } from './CaretLayer.jsx';

const steps = [{ notes: [{ x: 30, top: 10, bottom: 60, width: 12 }] }, { notes: [{ x: 80, top: 10, bottom: 60, width: 12 }] }];

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
