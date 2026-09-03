import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { AddCombobox } from './AddCombobox.jsx';

function r(ui) { return render(<MantineProvider>{ui}</MantineProvider>); }

const SUGGEST = { items: [
  { id: 'a', name: 'Chicken breast', favorite: true, nutrients: { calories: 231 } },
  { id: 'b', name: 'Chicken thigh', favorite: false, nutrients: { calories: 280 } },
] };

describe('AddCombobox', () => {
  beforeEach(() => { apiMock.mockReset(); });

  it('typing fetches suggestions; favorites are marked', async () => {
    apiMock.mockResolvedValue(SUGGEST);
    r(<AddCombobox bucketId="afternoon" onDone={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'chick' } });
    await waitFor(() => expect(screen.getByText('Chicken breast')).toBeTruthy());
    expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('suggest?q=chick'));
    expect(screen.getByText('Chicken breast').closest('.health-suggest__item--fav')).toBeTruthy();
  });

  it('picking a suggestion quick-adds with the bucket and calls onDone', async () => {
    apiMock.mockImplementation(async (path, body) => {
      if (path.includes('suggest')) return SUGGEST;
      // Real quickadd envelope — uuid lives at item.uuid, never top-level.
      if (path.includes('quickadd')) return { logged: true, item: { uuid: 'row-1' } };
      return {};
    });
    const onDone = vi.fn();
    r(<AddCombobox bucketId="afternoon" onDone={onDone} onCancel={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'chick' } });
    await waitFor(() => screen.getByText('Chicken breast'));
    fireEvent.click(screen.getByText('Chicken breast'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const quickaddCall = apiMock.mock.calls.find(([p]) => p.includes('quickadd'));
    expect(quickaddCall[1]).toMatchObject({ catalogEntryId: 'a' });
    const putCall = apiMock.mock.calls.find(([p]) => p.includes('nutrilist/row-1'));
    expect(putCall[1]).toMatchObject({ mealTime: 'afternoon' });
  });

  it('free sentence with no pick submits to the NL pipeline and, on commit, just calls onDone (no review phase)', async () => {
    // POST /nutrition/input now commits immediately — { committed: true, ... } —
    // the rows are already logged (unsettled). There is no review card to show;
    // the caller's onDone() triggers the day reload that surfaces them.
    apiMock.mockImplementation(async (path) => {
      if (path.includes('suggest')) return { items: [] };
      if (path.includes('nutrition/input')) return { committed: true, count: 1 };
      return {};
    });
    const onDone = vi.fn();
    r(<AddCombobox bucketId="morning" onDone={onDone} onCancel={() => {}} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '2 eggs and toast' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const inputCall = apiMock.mock.calls.find(([p]) => p.includes('nutrition/input'));
    expect(inputCall[1]).toMatchObject({ type: 'text', content: '2 eggs and toast' });
    // No review card of any kind — no Undo/Accept/Done affordance rendered here.
    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull();
  });

  it('a failed sentence submit preserves the typed text and shows the error (input never lost)', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path.includes('suggest')) return { items: [] };
      if (path.includes('nutrition/input')) throw new Error('network down');
      return {};
    });
    const onDone = vi.fn();
    r(<AddCombobox bucketId="morning" onDone={onDone} onCancel={() => {}} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '2 eggs and toast' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/network down/)).toBeTruthy());
    expect(input.value).toBe('2 eggs and toast');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('a slow older suggest response cannot overwrite a newer one (stale-response guard)', async () => {
    const older = { items: [{ id: 'x', name: 'OLD RESULT', nutrients: {} }] };
    const newer = { items: [{ id: 'y', name: 'NEW RESULT', nutrients: {} }] };
    let resolveOlder, resolveNewer;
    const olderPromise = new Promise((res) => { resolveOlder = res; });
    const newerPromise = new Promise((res) => { resolveNewer = res; });
    apiMock.mockImplementation((path) => {
      if (path.endsWith('q=c')) return olderPromise;
      if (path.endsWith('q=ch')) return newerPromise;
      return Promise.resolve({ items: [] });
    });

    r(<AddCombobox bucketId="afternoon" onDone={() => {}} onCancel={() => {}} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'c' } });
    // Real debounce delay — let the first ('c') request fire and stay in flight.
    await new Promise((res) => setTimeout(res, 300));

    fireEvent.change(input, { target: { value: 'ch' } });
    // Let the second ('ch') request fire and stay in flight too.
    await new Promise((res) => setTimeout(res, 300));

    // Newer resolves first (fast); older resolves later (slow) — the guard must
    // keep the newer results and ignore the stale older response.
    resolveNewer(newer);
    await waitFor(() => expect(screen.getByText('NEW RESULT')).toBeTruthy());

    resolveOlder(older);
    await new Promise((res) => setTimeout(res, 50));

    expect(screen.queryByText('OLD RESULT')).toBeFalsy();
    expect(screen.getByText('NEW RESULT')).toBeTruthy();
  }, 8000);
});
