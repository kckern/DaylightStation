import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import HeartIcon from './HeartIcon.jsx';
import { STRAP_COLORS, cssColorForStrap } from '../../../../../shared/contracts/fitness/strapColors.mjs';
import { cssColorForStrap as backendColor } from '../../../../../backend/src/2_domains/fitness/strapColors.mjs';

describe('HeartIcon', () => {
  it.each(Object.keys(STRAP_COLORS))('uses the shared %s strap color and fixed SVG geometry', color => {
    const { container } = render(<HeartIcon color={color} label={`${color} strap`} />);
    const icon = screen.getByRole('img', { name: `${color} strap` });
    expect(icon).toHaveStyle({ color: cssColorForStrap(color) });
    expect(backendColor(color)).toBe(cssColorForStrap(color));
    expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 24 24');
    expect(container.querySelector('svg')).toHaveAttribute('width', '18');
    expect(icon.textContent).toBe('');
  });

  it('keeps redundant hearts decorative and handles unknown colors consistently', () => {
    const { container } = render(<HeartIcon color="not-a-color" deviceId="strap-1" />);
    expect(container.querySelector('.fitness-heart-icon')).toHaveAttribute('aria-hidden', 'true');
    expect(cssColorForStrap('__proto__')).toBeNull();
  });
});
