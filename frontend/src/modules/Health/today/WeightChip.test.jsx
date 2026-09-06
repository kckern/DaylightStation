import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

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

  it('draws BOTH polylines — raw readings and the adjusted average', async () => {
    apiMock.mockResolvedValue(Object.fromEntries([
      entry('2026-09-01', 172.4, 172.0),
      entry('2026-09-02', 168.1, 171.8),
      entry('2026-09-04', 170.9, 171.6),
    ]));
    r(<WeightChip />);
    const raw = await screen.findByTestId('spark-raw');
    const avg = screen.getByTestId('spark-avg');
    expect(raw.getAttribute('points').split(' ')).toHaveLength(3);
    expect(avg.getAttribute('points').split(' ')).toHaveLength(3);
    expect(raw.getAttribute('points')).not.toBe(avg.getAttribute('points'));
  });

  it('draws the raw line only across days that were actually weighed', async () => {
    // The 3rd carries the 2nd's `lbs` forward with no `measurement` — the shape
    // of every unweighed day in the real file. Plotting it would draw a flat
    // run that reads as stability nobody measured.
    apiMock.mockResolvedValue({
      '2026-09-01': { date: '2026-09-01', lbs: 172.4, measurement: 172.4, lbs_adjusted_average: 172.0 },
      '2026-09-02': { date: '2026-09-02', lbs: 168.1, measurement: 168.1, lbs_adjusted_average: 171.8 },
      '2026-09-03': { date: '2026-09-03', lbs: 168.1, lbs_adjusted_average: 171.7 },
      '2026-09-04': { date: '2026-09-04', lbs: 170.9, measurement: 170.9, lbs_adjusted_average: 171.6 },
    });
    r(<WeightChip />);
    const raw = await screen.findByTestId('spark-raw');
    expect(raw.getAttribute('points').split(' ')).toHaveLength(3);        // not 4
    expect(screen.getByTestId('spark-avg').getAttribute('points').split(' ')).toHaveLength(4);
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
    expect(screen.queryByTestId('spark-raw')).toBeNull();
  });

  it('renders a dash, not a crash or a zero, with no weight data', async () => {
    apiMock.mockResolvedValue({});
    r(<WeightChip />);
    await waitFor(() => expect(screen.getByText('—')).toBeTruthy());
    expect(document.querySelector('.health-weightchip').getAttribute('aria-label')).toMatch(/no readings yet/);
  });
});
