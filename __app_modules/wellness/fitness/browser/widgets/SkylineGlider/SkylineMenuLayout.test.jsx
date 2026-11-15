import React from 'react';
import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SkylineMenuLayout from './SkylineMenuLayout.jsx';

it('keeps actions and utility outside the named content scroll region', () => {
  const { container } = render(<SkylineMenuLayout variant="bike" actions={<button>Retry</button>} utility={<button>More</button>}><p>Flight details</p></SkylineMenuLayout>);
  const content = screen.getByRole('region', { name: 'Game menu content' });
  expect(content).toHaveAttribute('tabindex', '0');
  expect(content).toHaveTextContent('Flight details');
  expect(content).not.toContainElement(screen.getByRole('button', { name: 'Retry' }));
  expect(content).not.toContainElement(screen.getByRole('button', { name: 'More' }));
  expect(container.querySelector('.skyline-menu-layout')).toHaveAttribute('data-variant', 'bike');
});
