import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { DaylightAPI } from '../../../../frontend/src/lib/api.mjs';
import ConfigTab from './ConfigTab.jsx';

vi.mock('../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
const goals = { weight: { target_lbs: 180 }, other: 'preserve' };
const program = { program: { id: 'original' }, other: 'preserve' };
const missing = Object.assign(new Error('File not found'), { status: 404, body: { code: 'NOT_FOUND' } });
const base = '/api/v1/admin/config/files/users/alex/agents/coach';
function mount() {
  render(<MantineProvider><ConfigTab userId="alex" agentId="coach" /></MantineProvider>);
}
beforeEach(() => { DaylightAPI.mockReset(); });
afterEach(cleanup);

it('blocks an unconfirmed document, preserves the other draft through Retry, and accepts a documented missing file', async () => {
  let recovered = false;
  DaylightAPI.mockImplementation(async path => {
    if (path.endsWith('/program-state')) return { parsed: program };
    if (!recovered) throw Object.assign(new Error('Denied'), { status: 403 });
    throw missing;
  });
  mount();
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Denied');
  expect(screen.queryByLabelText('Weight target (lbs)')).toBeNull();
  fireEvent.change(screen.getByLabelText('Program ID'), { target: { value: 'unsaved' } });
  recovered = true;
  fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
  const weight = await screen.findByLabelText('Weight target (lbs)');
  expect(weight).toHaveValue('');
  expect(screen.getByLabelText('Program ID')).toHaveValue('unsaved');
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  expect(DaylightAPI.mock.calls.every(([, , method]) => method !== 'PUT')).toBe(true);
});

it('keeps a program read failure out of Clear and Save while goals remain available', async () => {
  DaylightAPI.mockImplementation(async path => {
    if (path.endsWith('/goals')) return { parsed: goals };
    throw Object.assign(new Error('Unexpected 404'), { status: 404, body: { code: 'ROUTE_NOT_FOUND' } });
  });
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Unexpected 404');
  expect(screen.queryByRole('button', { name: 'Clear Program' })).toBeNull();
  expect(screen.getByLabelText('Weight target (lbs)')).toHaveValue('180');
});

it('keeps a malformed successful read out of the editor and preserves a confirmed missing program default', async () => {
  DaylightAPI.mockImplementation(async path => {
    if (path.endsWith('/goals')) return { raw: 'weight: [', parsed: null };
    throw missing;
  });
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('does not contain a configuration object');
  expect(screen.queryByLabelText('Weight target (lbs)')).toBeNull();
  expect(screen.getByText('No active program (ad-hoc mode)')).toBeVisible();
});

it('retains edits made during a save and preserves other document fields in both writes', async () => {
  let settle;
  DaylightAPI.mockImplementation((path, body, method) => method === 'PUT'
    ? new Promise(resolve => { settle = resolve; })
    : Promise.resolve({ parsed: path.endsWith('/goals') ? goals : program }));
  mount();
  const weight = await screen.findByLabelText('Weight target (lbs)');
  const save = screen.getByRole('button', { name: 'Save Goals' });
  fireEvent.change(weight, { target: { value: '170' } });
  fireEvent.click(save);
  expect(DaylightAPI).toHaveBeenCalledWith(base + '/goals', { parsed: { ...goals, weight: { target_lbs: 170 } } }, 'PUT');
  fireEvent.change(weight, { target: { value: '165' } });
  await act(async () => { settle({ ok: true }); });
  expect(save).toBeEnabled();
  fireEvent.click(save);
  expect(DaylightAPI).toHaveBeenCalledWith(base + '/goals', { parsed: { ...goals, weight: { target_lbs: 165 } } }, 'PUT');
  await act(async () => { settle({ ok: true }); });
  expect(save).toBeDisabled();
});

it('retains a failed clear and any local edits, then clears only the program on success', async () => {
  let rejectClear = true;
  DaylightAPI.mockImplementation(async (path, body, method) => {
    if (method !== 'PUT') return { parsed: path.endsWith('/goals') ? goals : program };
    if (rejectClear) throw new Error('Clear refused');
    return { ok: true };
  });
  mount();
  const id = await screen.findByLabelText('Program ID');
  fireEvent.change(id, { target: { value: 'pending edits' } });
  fireEvent.click(screen.getByRole('button', { name: 'Clear Program' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Clear refused');
  expect(screen.getByLabelText('Program ID')).toHaveValue('pending edits');
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  rejectClear = false;
  fireEvent.click(screen.getByRole('button', { name: 'Clear Program' }));
  expect(await screen.findByText('No active program (ad-hoc mode)')).toBeVisible();
  expect(DaylightAPI).toHaveBeenLastCalledWith(base + '/program-state', { parsed: { ...program, program: null } }, 'PUT');
});
