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
  beforeEach(() => apiMock.mockClear());

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

  it('move to Dinner PUTs mealTime to the GROUP row only (backend cascades to children)', async () => {
    const onChanged = vi.fn();
    mountGroup({ onChanged });
    fireEvent.click(screen.getByRole('button', { name: 'Dinner' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledTimes(1);
    const [path, body, method] = apiMock.mock.calls[0];
    expect(path).toContain('nutrilist/g1');
    expect(method).toBe('PUT');
    expect(body).toMatchObject({ mealTime: 'evening' });
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

  it('a PARTIAL delete failure reloads the day and surfaces an error, without pretending success', async () => {
    global.confirm = vi.fn(() => true);
    apiMock.mockImplementation(async (path) => {
      if (path?.includes('nutrilist/c2')) throw new Error('network down');
      return {};
    });
    const onChanged = vi.fn();
    mountGroup({ onChanged });
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    // Reality must be reloaded even though one delete failed.
    expect(onChanged).toHaveBeenCalled();
    // The user must be told — not left believing the whole group is gone.
    expect(await screen.findByText(/failed/i)).toBeTruthy();
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
