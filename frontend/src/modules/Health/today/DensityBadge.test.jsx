import React from 'react';
import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { DensityBadge } from './DensityBadge.jsx';
import { densityPresentation } from './densityPresentation.js';
import { MacroBadges } from './MacroBadges.jsx';

const mount = row => render(<MantineProvider><DensityBadge row={row} /></MantineProvider>);

it('describes exact, between, and outside ladder values in text', () => {
  expect(densityPresentation(1)).toMatchObject({ label: 'Lean · 1 kcal/g' });
  expect(densityPresentation(0.4)).toMatchObject({ label: 'Between Watery and Light · 0.4 kcal/g' });
  expect(densityPresentation(0)).toMatchObject({ label: 'Below Watery · 0 kcal/g' });
  expect(densityPresentation(9)).toMatchObject({ label: 'Above Oil · 9 kcal/g' });
});

it('keeps level names and density value available without relying on color', () => {
  mount({ grams: 100, calories: 100 });
  const target = screen.getByLabelText('Lean · 1 kcal/g');
  expect(target).toHaveClass('health-density-badge');
  expect(target.style.backgroundColor).toBeFalsy();
  expect(target.querySelector('.health-density-badge__visual')).toHaveTextContent('3');
  expect(target.querySelector('.health-density-badge__visual').style.backgroundColor).toBeTruthy();
});

it('does not display unknown mass as a false zero-density marker', () => {
  mount({ grams: null, calories: 100 });
  expect(screen.getByLabelText(/density unavailable/i)).toHaveTextContent('—');
  expect(screen.queryByLabelText(/watery/i)).toBeNull();
});

it('uses a read-only complete child rollup for a meal group', () => {
  mount({ kind: 'group', children: [
    { grams: 100, calories: 100 }, { grams: 100, calories: 300 },
  ] });
  expect(screen.getByLabelText('Between Hearty and Heavy · 2 kcal/g')).toBeTruthy();
});

it('shows visible P/C/F labels in meal totals', () => {
  render(<MantineProvider><MacroBadges rows={[{ protein: 10, carbs: 20, fat: 5 }]} showLabels /></MantineProvider>);
  expect([...document.querySelectorAll('.health-macro-badge--labelled')].map(node => node.dataset.shortLabel)).toEqual(['P', 'C', 'F']);
});
