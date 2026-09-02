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
