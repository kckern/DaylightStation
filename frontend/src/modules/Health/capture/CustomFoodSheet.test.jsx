/**
 * Unknown barcode -> create a catalog food -> quick-add it.
 *
 * This branch used to drop BOTH the meal the scan was launched from and the
 * day being viewed, so a custom food always landed in the clock's meal on the
 * server's today — even when the person was on another day, looking at the
 * meal row they had just scanned into.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { CustomFoodSheet } from './CustomFoodSheet.jsx';

function r(ui) { return render(<MantineProvider>{ui}</MantineProvider>); }

const quickaddBody = () => apiMock.mock.calls.find(([p]) => p.includes('quickadd'))[1];

async function save(props) {
  apiMock.mockImplementation(async (path) => (
    path.endsWith('nutrition/catalog') ? { entry: { id: 'e9' } } : { logged: true }
  ));
  r(<CustomFoodSheet upc="012345678905" open onClose={() => {}} onCreated={() => {}} {...props} />);
  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Trail mix' } });
  fireEvent.click(screen.getByRole('button', { name: /create & log/i }));
  await waitFor(() => expect(apiMock.mock.calls.some(([p]) => p.includes('quickadd'))).toBe(true));
}

describe('CustomFoodSheet', () => {
  beforeEach(() => { apiMock.mockReset(); });

  it('quick-adds into the meal the scan was launched from, on the day being viewed', async () => {
    await save({ bucketId: 'evening', date: '2026-09-03' });
    expect(quickaddBody()).toEqual({ catalogEntryId: 'e9', mealTime: 'evening', date: '2026-09-03' });
  });

  it('with neither, the body is unchanged — absent still means today and the clock\'s meal', async () => {
    await save({});
    expect(quickaddBody()).toEqual({ catalogEntryId: 'e9' });
  });
});
