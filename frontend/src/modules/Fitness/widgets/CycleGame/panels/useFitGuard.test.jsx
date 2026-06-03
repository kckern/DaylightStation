import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React, { useRef } from 'react';
import { useFitGuard } from './useFitGuard.js';

function Harness({ zoneBox }) {
  const ref = useRef(null);
  const scale = useFitGuard(ref, zoneBox, 'distanceChart');
  return <div data-testid="scale">{String(scale)}</div>;
}

describe('useFitGuard', () => {
  it('returns a scale of 1 when there is no zone box yet (jsdom content is 0)', () => {
    const { getByTestId } = render(<Harness zoneBox={{ width: 0, height: 0 }} />);
    expect(getByTestId('scale').textContent).toBe('1');
  });
  it('returns 1 when content fits (jsdom reports 0x0 content → fits any zone)', () => {
    const { getByTestId } = render(<Harness zoneBox={{ width: 300, height: 200 }} />);
    expect(getByTestId('scale').textContent).toBe('1');
  });
});
