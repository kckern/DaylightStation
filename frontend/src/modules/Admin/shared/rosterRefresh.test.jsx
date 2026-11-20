import { MantineProvider } from '@mantine/core';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: api }));

import MembersIndex from '../Household/MembersIndex.jsx';
import SchedulerIndex from '../Scheduler/SchedulerIndex.jsx';

afterEach(() => {
  cleanup();
  api.mockReset();
});

it.each([
  {
    Page: MembersIndex,
    path: '/api/v1/admin/household',
    command: '/api/v1/admin/household/members',
    initial: { members: [] },
    recovered: { members: [{ username: 'sample', display_name: 'Sample Member' }] },
    open: 'Add Member',
    submit: 'Add Member',
    fields: { Username: 'sample' },
    row: 'Sample Member',
    errorTitle: 'Household members failed to load',
  },
  {
    Page: SchedulerIndex,
    path: '/api/v1/admin/scheduler/jobs',
    command: '/api/v1/admin/scheduler/jobs',
    initial: { jobs: [] },
    recovered: { jobs: [{ id: 'sample', name: 'Sample Job', schedule: '0 * * * *' }] },
    open: 'Create Job',
    submit: 'Create',
    fields: { ID: 'sample', Name: 'Sample Job', Schedule: '0 * * * *' },
    row: 'Sample Job',
    errorTitle: 'Scheduler jobs failed to load',
  },
])('$open closes after success and retries only the roster GET if refresh fails', async ({
  Page, path, command, initial, recovered, open, submit, fields, row, errorTitle,
}) => {
  api.mockResolvedValueOnce(initial)
    .mockResolvedValueOnce({ ok: true })
    .mockRejectedValueOnce(new Error('Roster unavailable'))
    .mockResolvedValueOnce(recovered);
  render(<MantineProvider><MemoryRouter><Page /></MemoryRouter></MantineProvider>);

  fireEvent.click(await screen.findByRole('button', { name: open }));
  const dialog = await screen.findByRole('dialog');
  for (const [label, value] of Object.entries(fields)) {
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${label}\\b`)), { target: { value } });
  }
  fireEvent.click(within(dialog).getByRole('button', { name: submit }));

  expect(await screen.findByText(errorTitle)).toBeVisible();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(row)).toBeVisible();
  const rosterRead = [path, {}, 'GET', { signal: expect.any(AbortSignal) }];
  expect(api.mock.calls).toEqual([
    rosterRead,
    [command, expect.any(Object), 'POST'],
    rosterRead,
    rosterRead,
  ]);
});

it('keeps the newer scheduler run busy when its GET supersedes an older run’s GET', async () => {
  const jobs = { jobs: [
    { id: 'first', name: 'First Job', schedule: '0 * * * *' },
    { id: 'second', name: 'Second Job', schedule: '0 * * * *' },
  ] };
  let finishFirst;
  let finishSecond;
  api.mockResolvedValueOnce(jobs)
    .mockResolvedValueOnce({ ok: true })
    .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
    .mockResolvedValueOnce({ ok: true })
    .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve; }));
  render(<MantineProvider><MemoryRouter><SchedulerIndex /></MemoryRouter></MantineProvider>);

  const first = within(await screen.findByRole('row', { name: /First Job/ })).getByRole('button', { name: 'Run' });
  const second = within(screen.getByRole('row', { name: /Second Job/ })).getByRole('button', { name: 'Run' });
  fireEvent.click(first);
  await waitFor(() => expect(finishFirst).toBeTypeOf('function'));
  fireEvent.click(second);
  await waitFor(() => expect(finishSecond).toBeTypeOf('function'));
  expect(first).toBeEnabled();
  expect(second).toBeDisabled();

  await act(async () => finishFirst(jobs));
  expect(second).toBeDisabled();
  await act(async () => finishSecond(jobs));
  expect(second).toBeEnabled();
});
