import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// The one thing this file exists to pin: the Progress page fires TWO range
// requests, not fourteen per-day ones. Before Task 8.5 the adherence bars were
// a `Promise.all` over 14 `GET /budget?date=` calls fired on mount — the same
// fan-out the week strip had, on a page people open right after Today.
//
// ProgressView mounts Highcharts, which is why it had no test file at all
// (decision log §6.13). Highcharts is stubbed here rather than the whole
// component being left unverified: the chart's rendering is not what this
// asserts, the network shape is.
const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));
vi.mock('highcharts', () => ({ default: {} }));
vi.mock('highcharts-react-official', () => ({ default: () => <div data-testid="hc" /> }));

import { ProgressView } from './ProgressView.jsx';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';

const rangeDays = (from, to) => {
  const days = [];
  for (const d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    days.push({ date, budget: 2000, food: 1500, exercise: 300, remaining: 800, status: 'under', macros: {} });
  }
  return { days };
};

beforeEach(() => {
  resetApiResourceCache();
  apiMock.mockReset();
  apiMock.mockImplementation(async (path) => {
    if (path.includes('budget/range')) {
      const p = new URLSearchParams(path.split('?')[1]);
      return rangeDays(p.get('from'), p.get('to'));
    }
    if (path.includes('lifelog/weight')) return {};
    if (path.includes('health/goals')) return { goals: { heightIn: 70, birthYear: 1986, sex: 'male' } };
    return {};
  });
});

describe('ProgressView network shape', () => {
  it('asks for its windows as RANGES — never one request per day', async () => {
    render(<MantineProvider><ProgressView /></MantineProvider>);
    await waitFor(() => {
      const ranges = apiMock.mock.calls.map(([p]) => p).filter((p) => p.includes('budget/range'));
      expect(ranges).toHaveLength(2);
    });
    const paths = apiMock.mock.calls.map(([p]) => p);
    // The fan-out this task removed. Fourteen of these is the regression.
    expect(paths.filter((p) => /health\/budget\?date=/.test(p))).toHaveLength(0);
    // 14-day adherence and 30-day intake-vs-burn, one request each.
    const ranges = paths.filter((p) => p.includes('budget/range'));
    expect(new Set(ranges).size).toBe(2);
    expect(ranges.every((p) => /from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/.test(p))).toBe(true);
  });

  it('renders both range surfaces off those requests', async () => {
    render(<MantineProvider><ProgressView /></MantineProvider>);
    await waitFor(() => expect(document.querySelectorAll('.health-monthblock__fill').length).toBe(14));
    expect(document.querySelectorAll('.health-intakeburn__bar--intake').length).toBe(30);
    expect(document.querySelectorAll('.health-intakeburn__bar--burn').length).toBe(30);
  });
});
