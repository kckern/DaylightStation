import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ActivityHeatmap, getHeatColor } from './ActivityHeatmap.jsx';

describe('ActivityHeatmap', () => {
  it('uses a subtle surface color for empty days, not near-black dark-6', () => {
    expect(getHeatColor(0, 10)).toBe('var(--mantine-color-dark-4)');
    expect(getHeatColor(10, 10)).toBe('var(--mantine-color-green-6)');
  });
  it('renders a native <title> per in-range cell (no Tooltip portal storm)', () => {
    const days = { '2026-07-13': { sources: { a: 1 } }, '2026-07-14': { sources: {} } };
    const { container } = render(
      <MantineProvider><ActivityHeatmap days={days} /></MantineProvider>
    );
    expect(container.querySelectorAll('svg title').length).toBeGreaterThan(0);
  });
});
