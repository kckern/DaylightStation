import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn(async () => ({}));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { DismissStackProvider } from '@/lib/ui';
import { EntryEditSheet } from './EntryEditSheet.jsx';

const row = { uuid: 'r1', name: 'Eggs', calories: 140, protein: 12, carbs: 1, fat: 10, amount: 2, unit: 'lg', mealTime: 'morning' };
const mount = (props) => render(
  <MantineProvider>
    <DismissStackProvider>
      <EntryEditSheet row={row} open onClose={() => {}} onChanged={() => {}} {...props} />
    </DismissStackProvider>
  </MantineProvider>
);

describe('EntryEditSheet', () => {
  beforeEach(() => apiMock.mockClear());

  it('portion x2 PUTs scaled values', async () => {
    const onChanged = vi.fn();
    mount({ onChanged });
    fireEvent.click(screen.getByRole('button', { name: '×2' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [path, body, method] = apiMock.mock.calls[0];
    expect(path).toContain('nutrilist/r1');
    expect(method).toBe('PUT');
    expect(body.calories).toBe(280);
    expect(body.protein).toBe(24);
  });

  it('portion x4 PUTs scaled values', async () => {
    const onChanged = vi.fn();
    mount({ onChanged });
    fireEvent.click(screen.getByRole('button', { name: '×4' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [path, body, method] = apiMock.mock.calls[0];
    expect(path).toContain('nutrilist/r1');
    expect(method).toBe('PUT');
    expect(body.calories).toBe(560);
  });

  it('move to Dinner PUTs mealTime evening', async () => {
    const onChanged = vi.fn();
    mount({ onChanged });
    fireEvent.click(screen.getByRole('button', { name: 'Dinner' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(apiMock.mock.calls[0][1]).toMatchObject({ mealTime: 'evening' });
  });

  it('star favorites by name', async () => {
    mount({});
    fireEvent.click(screen.getByRole('button', { name: /favorite/i }));
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    const call = apiMock.mock.calls.find(([p]) => p.includes('catalog/favorite'));
    expect(call[1]).toMatchObject({ name: 'Eggs', favorite: true });
  });

  it('delete confirms then DELETEs', async () => {
    global.confirm = vi.fn(() => true);
    const onChanged = vi.fn();
    mount({ onChanged });
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const call = apiMock.mock.calls.find(([, , m]) => m === 'DELETE');
    expect(call[0]).toContain('nutrilist/r1');
  });
});

const groupRow = {
  uuid: 'g1', name: 'Smoothie', calories: 0, protein: 0, carbs: 0, fat: 0,
  kind: 'group', mealTime: 'morning',
  children: [
    { uuid: 'c1', name: 'Banana', calories: 100, protein: 1, carbs: 20, fat: 0, amount: 1, unit: 'ea' },
    { uuid: 'c2', name: 'Milk', calories: 120, protein: 8, carbs: 12, fat: 5, amount: 1, unit: 'cup' },
  ],
};
const mountGroup = (props) => render(
  <MantineProvider>
    <DismissStackProvider>
      <EntryEditSheet row={groupRow} open onClose={() => {}} onChanged={() => {}} {...props} />
    </DismissStackProvider>
  </MantineProvider>
);

describe('EntryEditSheet — item mode is unaffected', () => {
  beforeEach(() => apiMock.mockClear());

  it('an item row (no kind:group) shows Portion chips, not group scale/rename controls', () => {
    mount({});
    expect(screen.getByText('Portion')).toBeTruthy();
    expect(screen.getByRole('button', { name: '×2' })).toBeTruthy();
    expect(screen.queryByLabelText(/group name/i)).toBeNull();
    expect(screen.queryByText(/scale whole group/i)).toBeNull();
  });
});

describe('EntryEditSheet — group mode', () => {
  // `mockClear()` resets call history but NOT a `mockImplementation` set by
  // a previous test — several tests below install one, so restore the
  // shared default here or a later test silently inherits an earlier
  // test's override (observed: the "zero cascaded children" warning test
  // never fired because the prior test's `{ cascadedIds: [...] }` override
  // was still active).
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(async () => ({}));
  });

  it('renders rename, move, scale-group chips, and delete — no per-row Portion chips', () => {
    mountGroup({});
    expect(screen.getByLabelText(/group name/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /save/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dinner' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '×½' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '×¾' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '×1½' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '×2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeTruthy();
    // The per-row ×4/×3 factors from item mode must not leak into group mode.
    expect(screen.queryByRole('button', { name: '×4' })).toBeNull();
  });

  it('renders the current name in the rename field', () => {
    mountGroup({});
    expect(screen.getByLabelText(/group name/i).value).toBe('Smoothie');
  });

  it('rename PUTs the new name to the group uuid', async () => {
    const onChanged = vi.fn();
    mountGroup({ onChanged });
    fireEvent.change(screen.getByLabelText(/group name/i), { target: { value: 'Berry Smoothie' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [path, body, method] = apiMock.mock.calls[0];
    expect(path).toContain('nutrilist/g1');
    expect(method).toBe('PUT');
    expect(body).toMatchObject({ name: 'Berry Smoothie' });
  });

  it('move to Dinner PUTs mealTime to the GROUP row only, and closes cleanly when the backend confirms both children cascaded', async () => {
    apiMock.mockImplementation(async () => ({ cascadedIds: ['c1', 'c2'] }));
    const onChanged = vi.fn();
    const onClose = vi.fn();
    mountGroup({ onChanged, onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Dinner' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledTimes(1);
    const [path, body, method] = apiMock.mock.calls[0];
    expect(path).toContain('nutrilist/g1');
    expect(method).toBe('PUT');
    expect(body).toMatchObject({ mealTime: 'evening' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText(/did not move/i)).toBeNull();
  });

  it('move to Dinner surfaces a warning (and does NOT close) when the backend reports zero cascaded children', async () => {
    // Default apiMock resolves `{}` — no `cascadedIds` at all. This is
    // exactly the fail-open shape HealthOperations returns when the
    // cascade silently no-ops (e.g. the group row is missing `date`) — the
    // group itself still moved, but its children did not, and the sheet
    // must say so rather than closing as if everything moved together.
    const onChanged = vi.fn();
    const onClose = vi.fn();
    mountGroup({ onChanged, onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Dinner' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(await screen.findByText(/did not move/i)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('scale ×2 PUTs scaled values to EVERY child row, not the group row', async () => {
    const onChanged = vi.fn();
    mountGroup({ onChanged });
    fireEvent.click(screen.getByRole('button', { name: '×2' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledTimes(2);
    const paths = apiMock.mock.calls.map((c) => c[0]);
    expect(paths.some((p) => p.includes('nutrilist/c1'))).toBe(true);
    expect(paths.some((p) => p.includes('nutrilist/c2'))).toBe(true);
    expect(paths.some((p) => p.includes('nutrilist/g1'))).toBe(false);
    const c1Call = apiMock.mock.calls.find((c) => c[0].includes('nutrilist/c1'));
    expect(c1Call[1].calories).toBe(200);
    const c2Call = apiMock.mock.calls.find((c) => c[0].includes('nutrilist/c2'));
    expect(c2Call[1].calories).toBe(240);
  });

  it('delete confirms with the child count, then DELETEs the group AND every child', async () => {
    global.confirm = vi.fn(() => true);
    const onChanged = vi.fn();
    mountGroup({ onChanged });
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(global.confirm).toHaveBeenCalledWith(expect.stringMatching(/smoothie.*2/i));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const deleteCalls = apiMock.mock.calls.filter((c) => c[2] === 'DELETE');
    expect(deleteCalls).toHaveLength(3);
    const paths = deleteCalls.map((c) => c[0]);
    expect(paths.some((p) => p.includes('nutrilist/g1'))).toBe(true);
    expect(paths.some((p) => p.includes('nutrilist/c1'))).toBe(true);
    expect(paths.some((p) => p.includes('nutrilist/c2'))).toBe(true);
  });

  it('does not delete without confirmation', () => {
    global.confirm = vi.fn(() => false);
    mountGroup({});
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('a PARTIAL delete failure (a child) leaves the group row IN PLACE — its own DELETE is never issued', async () => {
    global.confirm = vi.fn(() => true);
    apiMock.mockImplementation(async (path) => {
      if (path?.includes('nutrilist/c2')) throw new Error('network down');
      return {};
    });
    const onChanged = vi.fn();
    const onClose = vi.fn();
    mountGroup({ onChanged, onClose });
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());

    const deleteCalls = apiMock.mock.calls.filter((c) => c[2] === 'DELETE');
    const paths = deleteCalls.map((c) => c[0]);
    // Both children were attempted (continue-on-failure for children is
    // unchanged)...
    expect(paths.some((p) => p.includes('nutrilist/c1'))).toBe(true);
    expect(paths.some((p) => p.includes('nutrilist/c2'))).toBe(true);
    // ...but the group's OWN delete must never fire when a child failed —
    // deleting the dish while stranding a surviving ingredient is exactly
    // the bug this test guards against.
    expect(paths.some((p) => p.includes('nutrilist/g1'))).toBe(false);
    // The sheet stays open (it wasn't fully deleted) and says so plainly.
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText(/not deleted/i)).toBeTruthy();
  });

  it('once every child succeeds but the GROUP\'s own delete fails, the failure is reported distinctly (children are already gone)', async () => {
    global.confirm = vi.fn(() => true);
    apiMock.mockImplementation(async (path) => {
      if (path?.includes('nutrilist/g1')) throw new Error('network down');
      return {};
    });
    const onChanged = vi.fn();
    const onClose = vi.fn();
    mountGroup({ onChanged, onClose });
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());

    const deleteCalls = apiMock.mock.calls.filter((c) => c[2] === 'DELETE');
    const paths = deleteCalls.map((c) => c[0]);
    expect(paths.some((p) => p.includes('nutrilist/c1'))).toBe(true);
    expect(paths.some((p) => p.includes('nutrilist/c2'))).toBe(true);
    // The group delete WAS attempted here (both children succeeded first).
    expect(paths.some((p) => p.includes('nutrilist/g1'))).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText(/could not be deleted/i)).toBeTruthy();
  });

  it('a PARTIAL scale failure reloads the day and surfaces an error, without pretending success', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path?.includes('nutrilist/c1')) throw new Error('network down');
      return {};
    });
    const onChanged = vi.fn();
    mountGroup({ onChanged });
    fireEvent.click(screen.getByRole('button', { name: '×2' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByText(/failed/i)).toBeTruthy();
    // The one child that DID succeed must still have been attempted.
    const c2Call = apiMock.mock.calls.find((c) => c[0].includes('nutrilist/c2'));
    expect(c2Call).toBeTruthy();
  });
});

// Task 5.4 — the Measurements section: re-pair a scale measurement to this entry.
describe('EntryEditSheet — Measurements', () => {
  const OBS = {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    kind: 'weight', value: 82, unit: 'g', scaleId: 'kitchen-1',
    at: '2026-09-02 18:04:12', date: '2026-09-02', status: 'open', pairedEntryUuid: null,
  };

  // Reset the IMPLEMENTATION, not just the call log: a rejection queued by one test
  // would otherwise stay armed for the next one (and surface as an unhandled rejection).
  beforeEach(() => { apiMock.mockReset(); apiMock.mockImplementation(async () => ({})); });

  it('is absent entirely when the day has no observations — no empty heading', () => {
    mount({ observations: [] });
    expect(screen.queryByText('Measurements')).toBeNull();
  });

  it('lists the day\'s measurements with a pair action named after each row', () => {
    mount({ observations: [OBS] });
    expect(screen.getByText('Measurements')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pair 82 g on the kitchen scale at 18:04 to this entry' })).toBeTruthy();
  });

  it('pairing POSTs the entry uuid to the pair endpoint and reloads both sides', async () => {
    apiMock.mockImplementation(async () => ({ observation: { ...OBS, status: 'consumed', pairedEntryUuid: 'r1' } }));
    const onChanged = vi.fn();
    const onPaired = vi.fn();
    mount({ observations: [OBS], onChanged, onPaired });

    fireEvent.click(screen.getByRole('button', { name: /Pair .* to this entry/ }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith(
      `api/v1/health/nutrition/observations/${OBS.id}/pair`,
      { entryUuid: 'r1' },
      'POST',
    );
    expect(onPaired).toHaveBeenCalledWith(null);
  });

  it('a DISMISSED measurement is not re-offered — the person already threw it away', () => {
    mount({ observations: [{ ...OBS, status: 'dismissed' }] });
    expect(screen.queryByText('Measurements')).toBeNull();
    expect(screen.queryByRole('button', { name: /Pair .* to this entry/ })).toBeNull();
  });

  it('a refusal shows the SERVER\'s sentence, not the raw HTTP wrapper', async () => {
    // DaylightAPI wraps a non-2xx as `HTTP 409: Conflict - {json}`; the body's `error` is
    // the sentence written for this situation and is what the person must read.
    apiMock.mockImplementation(async () => {
      const err = new Error('HTTP 409: Conflict - {"error":"This measurement is what \\"Soup\\" (210 kcal) was calculated from. Delete or correct \\"Soup\\" first.","code":"PRIOR_ENTRY_EXISTS"}');
      err.status = 409;
      throw err;
    });
    const onClose = vi.fn();
    mount({ observations: [OBS], onClose });

    fireEvent.click(screen.getByRole('button', { name: /Pair .* to this entry/ }));

    await waitFor(() => expect(screen.getByText(/Delete or correct "Soup" first/)).toBeTruthy());
    expect(screen.queryByText(/HTTP 409/)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a refused re-pair surfaces the reason and does NOT close on a lie', async () => {
    apiMock.mockImplementation(async () => {
      throw new Error('Nothing was changed — dismiss or re-pair them one at a time.');
    });
    const onClose = vi.fn();
    const onPaired = vi.fn();
    mount({ observations: [OBS], onClose, onPaired });

    fireEvent.click(screen.getByRole('button', { name: /Pair .* to this entry/ }));

    await waitFor(() => expect(screen.getByText(/Nothing was changed/)).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    expect(onPaired).toHaveBeenCalledWith(expect.any(Error));
  });

  it('a measurement already attached to THIS entry is shown as Attached, not re-pairable', () => {
    mount({ observations: [{ ...OBS, status: 'consumed', pairedEntryUuid: 'r1' }] });
    const btn = screen.getByRole('button', { name: /Pair .* to this entry/ });
    expect(btn.textContent).toContain('Attached');
    expect(btn).toBeDisabled();
  });
});
