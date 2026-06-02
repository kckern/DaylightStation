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
});
