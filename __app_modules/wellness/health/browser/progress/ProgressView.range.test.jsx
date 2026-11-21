import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// Stub the chart renderer so these tests can exercise the real Progress view
// and its resource reads without requiring a browser layout engine.
const apiMock = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...a) => apiMock(...a) }));
vi.mock('highcharts', () => ({ default: {} }));
vi.mock('highcharts-react-official', () => ({ default: () => <div data-testid="hc" /> }));

import { ProgressView } from "./ProgressView.jsx";
import { isApiResourceFresh, primeApiResource, resetApiResourceCache } from "../../../../../frontend/src/lib/hooks/useApiResource.js";

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
    if (path === 'api/v1/health/weight') return {};
    if (path.includes('health/goals')) return { goals: { heightIn: 70, birthYear: 1986, sex: 'male' } };
    return {};
  });
});

describe('ProgressView resource reads', () => {
  it('retries a failed initial goals read and opens the editor with the saved goals', async () => {
    const fallback = apiMock.getMockImplementation();
    let rejectInitialGoals;
    const initialGoals = new Promise((_, reject) => { rejectInitialGoals = reject; });
    let goalReads = 0;
    apiMock.mockImplementation((path, ...args) => {
      if (path === 'api/v1/health/goals') {
        if (++goalReads === 1) return initialGoals;
        return Promise.resolve({ goals: { sex: 'female', targetWeightLbs: 155, weeklyRateLbs: 0.5, budgetFloor: 1500, heightIn: 66, birthYear: 1986 } });
      }
      return fallback(path, ...args);
    });

    render(<MantineProvider><ProgressView /></MantineProvider>);
    expect(screen.queryByRole('button', { name: 'Edit goals' })).toBeNull();
    await act(async () => { rejectInitialGoals(new Error('Goals unavailable')); });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Goals failed to load');
    expect(screen.queryByRole('button', { name: 'Edit goals' })).toBeNull();

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Target 155 lb · 0.5 lb/week · Floor 1500 kcal')).toBeVisible();
    const goalsCalls = apiMock.mock.calls.filter(([path]) => path === 'api/v1/health/goals');
    expect(goalsCalls.map(([, , method]) => method)).toEqual(['GET', 'GET']);
    fireEvent.click(screen.getByRole('button', { name: 'Edit goals' }));
    expect(await screen.findByLabelText('Target weight')).toHaveValue('155 lbs');
  });

  it('reads Health weight history and shows the latest adjusted weight', async () => {
    const fallback = apiMock.getMockImplementation();
    apiMock.mockImplementation((path) => path === 'api/v1/health/weight' ? Promise.resolve({
      '2026-09-03': { date: '2026-09-03', lbs: 172.4, measurement: 172.4, lbs_adjusted_average: 172.0 },
      '2026-09-10': { date: '2026-09-10', lbs: 170.9, measurement: 170.9, lbs_adjusted_average: 171.6 },
    }) : fallback(path));

    render(<MantineProvider><ProgressView /></MantineProvider>);
    expect(await screen.findByText('Weight · as of 2026-09-10')).toBeVisible();
    expect(screen.getByText('171.6')).toBeVisible();
    const weightCalls = apiMock.mock.calls.filter(([path]) => path === 'api/v1/health/weight');
    expect(weightCalls.map(([, , method]) => method)).toEqual(['GET']);
  });
});

describe('committed Health writes', () => {
  it('refreshes goals in a replacement Progress view after the original save finishes', async () => {
    const fallback = apiMock.getMockImplementation();
    const save = Promise.withResolvers();
    let target = 155;
    apiMock.mockImplementation((path, body, method) => {
      if (path !== 'api/v1/health/goals') return fallback(path, body, method);
      if (method === 'PUT') return save.promise.then(() => { target = 160; });
      return Promise.resolve({ goals: { targetWeightLbs: target } });
    });
    const mount = () => render(<MantineProvider><ProgressView /></MantineProvider>);
    const first = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit goals' }));
    fireEvent.change(await screen.findByLabelText('Target weight'), { target: { value: '160' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save goals' }));
    expect(apiMock).toHaveBeenCalledWith('api/v1/health/goals', expect.objectContaining({ targetWeightLbs: 160 }), 'PUT');
    first.unmount();
    mount();
    await screen.findByText(/Target 155 lb/);
    const rangeReads = () => apiMock.mock.calls.filter(([path]) => path.includes('budget/range')).length;
    const before = rangeReads();
    const dayPath = 'api/v1/health/day?date=2026-09-23';
    const unrelated = 'api/v1/health/dashboard';
    primeApiResource(dayPath, { budget: {} });
    primeApiResource(unrelated, {});
    await act(async () => save.resolve());
    expect(await screen.findByText(/Target 160 lb/)).toBeVisible();
    expect(rangeReads()).toBe(before + 2);
    expect(isApiResourceFresh(dayPath)).toBe(false);
    expect(isApiResourceFresh(unrelated)).toBe(true);
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
