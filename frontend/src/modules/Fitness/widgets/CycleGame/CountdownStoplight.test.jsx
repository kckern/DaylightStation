import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CountdownStoplight from './CountdownStoplight.jsx';

describe('CountdownStoplight', () => {
  it('shows the remaining count and lights the right lamp', () => {
    const { getByTestId } = render(<CountdownStoplight remaining={3} total={3} />);
    expect(getByTestId('countdown-number').textContent).toBe('3');
    // 3 of 3 → top (red) lamp active
    expect(getByTestId('lamp-red').className).toContain('is-on');
  });
  it('shows GO at 0', () => {
    const { getByTestId } = render(<CountdownStoplight remaining={0} total={3} />);
    expect(getByTestId('countdown-number').textContent).toBe('GO');
    expect(getByTestId('lamp-green').className).toContain('is-on');
  });
  it('runs ALL3 → RED → YELLOW → GREEN with no double yellow', () => {
    const on = (c, id) => c.querySelector(`[data-testid="${id}"]`).className.includes('is-on');
    const all = render(<CountdownStoplight remaining={3} total={3} />).container;
    expect(on(all, 'lamp-red')).toBe(true);
    expect(on(all, 'lamp-yellow')).toBe(true);
    expect(on(all, 'lamp-green')).toBe(true);
    const red = render(<CountdownStoplight remaining={2} total={3} />).container;
    expect(on(red, 'lamp-red')).toBe(true);
    expect(on(red, 'lamp-yellow')).toBe(false);
    const yellow = render(<CountdownStoplight remaining={1} total={3} />).container;
    expect(on(yellow, 'lamp-yellow')).toBe(true);
    expect(on(yellow, 'lamp-red')).toBe(false);
  });
});
