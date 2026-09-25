import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

// Highcharts has no layout engine to render into under jsdom; the chip's job is
// to hand the chart the right entries, so the chart is stubbed to show them.
vi.mock('../progress/WeightTrendChart.jsx', () => ({
  WeightTrendChart: ({ entries }) => <div data-testid="chart-stub" data-dates={entries.map(e => e.date).join(',')}
    data-measured={entries.filter(e => e.measurement != null).length} />,
}));

import { WeightChip } from './WeightChip.jsx';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';

function r(ui) { return render(<MantineProvider>{ui}</MantineProvider>); }

// `measurement` is set alongside `lbs` because these fixtures mean "a day that
// was actually weighed". A day that was NOT weighed still carries `lbs`,
// forward-filled — see the forward-fill test below.
const entry = (date, lbs, avg) => [date, { date, lbs, measurement: lbs, lbs_adjusted_average: avg }];

beforeEach(() => {
  resetApiResourceCache();
  apiMock.mockReset();
});

describe('WeightChip', () => {
  it('reads the weight endpoint once and shows the latest adjusted average', async () => {
    apiMock.mockResolvedValue(Object.fromEntries([
      entry('2026-08-28', 172.4, 172.0),
      entry('2026-09-04', 170.9, 171.6),
    ]));
    r(<WeightChip />);
    expect(await screen.findByText('171.6')).toBeTruthy();
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('api/v1/health/weight');
  });

  it('shows the 7-day delta with an arrow, not colour alone', async () => {
    apiMock.mockResolvedValue(Object.fromEntries([
      entry('2026-08-28', 172.4, 172.0),
      entry('2026-09-04', 170.9, 171.6),
    ]));
    r(<WeightChip />);
    const delta = await screen.findByTestId('weight-delta');
    expect(delta.textContent).toContain('−0.4');
    expect(delta.textContent).toContain('▼');       // the non-colour cue
    expect(delta.className).toMatch(/delta--down/);
  });

  it('draws the twelve-week trend chart from the whole normalized history, up to asOf', async () => {
    // The chart itself (dots only on weighed days, the average area, the water
    // hairline) is pinned in progress/weightChart.test.js; here, the chip must
    // hand it every day — measured or not — and nothing after the viewed day.
    apiMock.mockResolvedValue({
      '2026-09-01': { date: '2026-09-01', lbs: 172.4, measurement: 172.4, lbs_adjusted_average: 172.0 },
      '2026-09-02': { date: '2026-09-02', lbs: 168.1, measurement: 168.1, lbs_adjusted_average: 171.8 },
      '2026-09-03': { date: '2026-09-03', lbs: 168.1, lbs_adjusted_average: 171.7 },
      '2026-09-04': { date: '2026-09-04', lbs: 170.9, measurement: 170.9, lbs_adjusted_average: 171.6 },
    });
    r(<WeightChip asOf="2026-09-03" />);
    const chart = await screen.findByTestId('chart-stub');
    expect(chart.dataset.dates).toBe('2026-09-01,2026-09-02,2026-09-03');
    expect(chart.dataset.measured).toBe('2');
  });

  it('says so, rather than printing a confident zero, when there is no 7-day trend yet', async () => {
    apiMock.mockResolvedValue(Object.fromEntries([entry('2026-09-04', 170.9, 171.6)]));
    r(<WeightChip />);
    expect(await screen.findByTestId('weight-delta-none')).toBeTruthy();
    expect(screen.queryByTestId('weight-delta')).toBeNull();
  });

  it('draws no line at all from a single reading', async () => {
    apiMock.mockResolvedValue(Object.fromEntries([entry('2026-09-04', 170.9, 171.6)]));
    r(<WeightChip />);
    expect(await screen.findByTestId('spark-empty')).toBeTruthy();
    expect(screen.queryByTestId('chart-stub')).toBeNull();
  });

  it('renders a dash, not a crash or a zero, with no weight data', async () => {
    apiMock.mockResolvedValue({});
    r(<WeightChip />);
    await waitFor(() => expect(screen.getByText('—')).toBeTruthy());
    expect(document.querySelector('.health-weightchip').getAttribute('aria-label')).toMatch(/no readings yet/);
  });
});
