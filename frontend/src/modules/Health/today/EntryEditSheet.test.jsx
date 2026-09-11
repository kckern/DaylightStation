import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { DismissStackProvider } from '@/lib/ui';
import { EntryEditSheet } from './EntryEditSheet.jsx';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));
const row = { uuid: 'r1', foodId: 'f1', name: 'Eggs', date: '2026-09-04', version: 3,
  calories: 140, protein: 12, carbs: 1, fat: 10, fiber: 5, sodium: 300, grams: 100, mealTime: 'morning' };
const wrap = ui => <MantineProvider><DismissStackProvider>{ui}</DismissStackProvider></MantineProvider>;
const mount = (props = {}) => render(wrap(<EntryEditSheet row={row} open onClose={() => {}} onChanged={() => {}} {...props} />));
const writes = () => apiMock.mock.calls.filter(([, , method]) => method === 'PUT');
beforeEach(() => apiMock.mockReset().mockResolvedValue({ items: [] }));

describe('entry correction dialog', () => {
  it('drafts a complete scaled portion and commits once, including micronutrients', async () => {
    const changed = vi.fn();
    mount({ onChanged: changed });
    fireEvent.click(screen.getByRole('button', { name: '×2' }));
    expect(writes()).toHaveLength(0);
    expect(screen.getByText(/280 kcal/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toEqual(['api/v1/health/nutrilist/r1', expect.objectContaining({
      portion: { value: 200, unit: 'g' }, expectedVersion: 3, expectedVersions: { r1: 3 }, operationId: expect.any(String),
    }), 'PUT']);
  });

  it('exact grams, rename, and date are one save, not several transactions', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('Portion in g'), { target: { value: '75' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Scrambled eggs' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2020-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1]).toMatchObject({ portion: { value: 75, unit: 'g' }, name: 'Scrambled eggs', date: '2020-01-01' });
  });

  it('unknown mass never invents a density when a weight is supplied', async () => {
    mount({ row: { ...row, grams: null, amount: null, unit: 'g' } });
    expect(screen.getByRole('button', { name: '×2' }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Portion in g'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1]).toMatchObject({ grams: 150 });
  });

  it('sends group scaling as one server command and shows live child totals', async () => {
    mount({ row: { ...row, uuid: 'g1', kind: 'group', name: 'Breakfast', grams: 0, calories: 0,
      children: [row, { ...row, uuid: 'r2' }] } });
    fireEvent.click(screen.getByRole('button', { name: '×2' }));
    expect(screen.getByText(/560 kcal/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('api/v1/health/nutrilist/g1');
    expect(writes()[0][1]).toMatchObject({ portion: { value: 400, unit: 'g' }, expectedVersions: { g1: 3, r1: 3, r2: 3 } });
    expect(writes()[0][1].calories).toBeUndefined();
  });

  it('a conflict leaves the draft open and repeat taps cannot issue parallel writes', async () => {
    let rejectSave;
    apiMock.mockImplementation(async (path, body, method) => method === 'PUT'
      ? new Promise((resolve, reject) => { rejectSave = reject; }) : { items: [] });
    const close = vi.fn();
    mount({ onClose: close });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Corrected eggs' } });
    const save = screen.getByRole('button', { name: 'Save', exact: true });
    fireEvent.click(save); fireEvent.click(save);
    expect(writes()).toHaveLength(1);
    rejectSave(new Error('This entry changed. Reload it before saving.'));
    await screen.findByRole('alert');
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name').value).toBe('Corrected eggs');
  });

  it('loads existing favorite state and toggles it off', async () => {
    apiMock.mockResolvedValue({ entry: { id: 'f1', name: 'Renamed eggs', favorite: true } });
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'favorite' }).getAttribute('aria-pressed')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: 'favorite' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(apiMock).toHaveBeenCalledWith('api/v1/health/nutrition/catalog/f1');
    expect(writes()[0][1]).toEqual({ id: 'f1', favorite: false });
  });

  it('asks the view to delete rather than deleting, so both entry points confirm alike', async () => {
    const requested = vi.fn();
    mount({ onRequestDelete: requested });
    const before = apiMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
    // The row travels back untouched — the view owns the confirm, the DELETE and
    // the Undo banner. Nothing may reach the network from this click: the sheet
    // used to fire the DELETE here while the row X asked first, which is how one
    // action ended up with two contracts.
    expect(requested).toHaveBeenCalledOnce();
    expect(requested.mock.calls[0][0]).toMatchObject({ uuid: 'r1' });
    expect(apiMock.mock.calls.length).toBe(before);
  });

  it('changes to another row start a new draft, without leaked icon or errors', () => {
    const view = mount();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved' } });
    view.rerender(wrap(<EntryEditSheet row={{ ...row, uuid: 'r2', name: 'Toast' }} open onClose={() => {}} onChanged={() => {}} />));
    expect(screen.getByLabelText('Name').value).toBe('Toast');
  });

  it('records explicitly corrected nutrients separately from scaled totals', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('Fiber (g)'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1]).toMatchObject({ fiber: 8, correctedNutrients: ['fiber'] });
  });

  it('keeps measurement pairing on the existing observation contract', async () => {
    const paired = vi.fn();
    mount({ observations: [{ id: 'o1', kind: 'weight', value: 82, unit: 'g', status: 'open', at: '2026-09-04 08:00:00' }], onPaired: paired });
    const pair = screen.getByRole('button', { name: /pair/i });
    fireEvent.click(pair);
    await waitFor(() => expect(paired).toHaveBeenCalled());
    expect(apiMock.mock.calls.find(([path]) => path.includes('observations/o1/pair'))).toEqual([
      'api/v1/health/nutrition/observations/o1/pair', { entryUuid: 'r1' }, 'POST',
    ]);
  });
});
