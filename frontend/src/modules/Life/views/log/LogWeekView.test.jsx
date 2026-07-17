import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// The component's actual data hook is `useLifelog` (unified hook), returning
// { data, loading, error, refetch } — not a per-scope `useLifelogWeek`.
vi.mock('../../hooks/useLifelog.js', () => ({
  useLifelog: () => ({
    loading: false,
    error: null,
    refetch: vi.fn(),
    data: { days: { '2026-07-13': { sources: { steps: {} } } } },
  }),
}));

// Isolate LogWeekView's own date formatting from ActivityHeatmap, which
// renders per-cell ISO dates into hidden SVG <title> tooltips regardless of
// this sweep (it's out of scope for Task 7).
vi.mock('./shared/ActivityHeatmap.jsx', () => ({
  ActivityHeatmap: () => null,
}));

import { LogWeekView } from './LogWeekView.jsx';

const wrap = (ui) => render(<MantineProvider>{ui}</MantineProvider>);
beforeEach(() => {});

describe('LogWeekView', () => {
  it('shows a human date, not a raw ISO string', () => {
    wrap(<LogWeekView />);
    // The per-day card date must not contain a raw ISO date.
    expect(document.body.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
