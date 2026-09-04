import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { useBudgetRange } from './useBudgetRange.js';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';

let seen;
function Probe({ from, to, enabled }) {
  seen = useBudgetRange(from, to, { enabled });
  return null;
}

beforeEach(() => {
  resetApiResourceCache();
  seen = undefined;
  apiMock.mockReset();
  apiMock.mockResolvedValue({ days: [
    { date: '2026-09-01', budget: 2000, food: 1000, status: 'under' },
    { date: '2026-09-02', error: 'NO_WEIGHT_DATA' },
  ] });
});

describe('useBudgetRange', () => {
  it('makes exactly one request for a range and indexes the days by date', async () => {
    render(<Probe from="2026-09-01" to="2026-09-02" />);
    await waitFor(() => expect(seen.days).toHaveLength(2));
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('api/v1/health/budget/range?from=2026-09-01&to=2026-09-02');
    expect(seen.byDate.get('2026-09-01').food).toBe(1000);
  });

  it('keeps gap entries in the list — a caller drawing holes needs to know where they are', async () => {
    render(<Probe from="2026-09-01" to="2026-09-02" />);
    await waitFor(() => expect(seen.days).toHaveLength(2));
    expect(seen.byDate.get('2026-09-02')).toEqual({ date: '2026-09-02', error: 'NO_WEIGHT_DATA' });
  });

  // The mount gate's whole purpose: a phone must not fetch a month of budgets
  // for a sidebar it will never render.
  it('makes NO request at all when disabled', async () => {
    render(<Probe from="2026-08-04" to="2026-09-02" enabled={false} />);
    await waitFor(() => expect(seen.loading).toBe(false));
    expect(apiMock).not.toHaveBeenCalled();
    expect(seen.days).toEqual([]);
  });

  it('makes no request without a range', async () => {
    render(<Probe from={null} to={null} />);
    await waitFor(() => expect(seen.loading).toBe(false));
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('serves a second mount of the SAME range from cache instead of blanking', async () => {
    const first = render(<Probe from="2026-09-01" to="2026-09-02" />);
    await waitFor(() => expect(seen.days).toHaveLength(2));
    first.unmount();

    render(<Probe from="2026-09-01" to="2026-09-02" />);
    // Cache hit: data is present on the very first render, before the
    // background revalidation resolves.
    expect(seen.days).toHaveLength(2);
    expect(seen.loading).toBe(false);
  });
});
