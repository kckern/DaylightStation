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
  it('renders nothing when there are no steps', () => {
    const { container } = render(<CaretLayer steps={[]} caretStepIndex={0} scale={1} />);
    expect(container.querySelector('.composer-caret')).toBeNull();
  });
});
