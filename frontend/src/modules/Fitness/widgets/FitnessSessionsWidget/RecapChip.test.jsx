import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RecapChip from './RecapChip.jsx';

describe('RecapChip', () => {
  it('renders an svg play-triangle chip', () => {
    const { container } = render(<RecapChip />);
    const chip = container.querySelector('.session-row__recap-chip');
    expect(chip).toBeTruthy();
    expect(chip.querySelector('svg')).toBeTruthy();
  });
});
