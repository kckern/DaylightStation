import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { beforeEach, expect, it, vi } from 'vitest';
import { DaylightAPI } from '../../../../frontend/src/lib/api.mjs';
import OverviewTab from './OverviewTab.jsx';

vi.mock('../../../../frontend/src/lib/api.mjs', async importOriginal => ({
  ...await importOriginal(), DaylightAPI: vi.fn(),
}));
beforeEach(() => { DaylightAPI.mockReset(); });

function view(agentId, userId) {
  return <MantineProvider><OverviewTab agentId={agentId} userId={userId} /></MantineProvider>;
}

function memory(value) {
  return { entries: { note: { value } } };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

it('preserves the agent assignment read across member switches and retires late delete and run feedback', async () => {
  const deletion = deferred();
  const run = deferred();
  DaylightAPI.mockImplementation(async (path, body, method) => {
    if (method === 'DELETE') return deletion.promise;
    if (method === 'POST') return run.promise;
    if (path.endsWith('/assignments')) return { assignments: [{ id: 'digest' }] };
    return memory(path.endsWith('/bob') ? 'Bob memory' : 'Alice memory');
  });
  const { rerender } = render(view('coach', 'alice'));
  await screen.findByText('Alice memory');
  fireEvent.click(within(screen.getByRole('row', { name: /Alice memory/ })).getByRole('button'));
  fireEvent.click(screen.getByRole('button', { name: 'Run Now' }));
  rerender(view('coach', 'bob'));
  await screen.findByText('Bob memory');
  await act(async () => { deletion.resolve({}); run.resolve({}); });
  expect(screen.getByText('Bob memory')).toBeVisible();
  expect(screen.queryByText('digest: Completed')).toBeNull();
  const calls = DaylightAPI.mock.calls;
  expect(calls.filter(([path]) => path.endsWith('/assignments'))).toHaveLength(1);
  expect(calls.filter(([path, , method]) => path.endsWith('/memory/alice') && !method)).toHaveLength(1);
});

it('ignores late memory and assignment reads from a departed agent', async () => {
  const oldAssignments = deferred();
  const oldMemory = deferred();
  DaylightAPI.mockImplementation(async path => {
    if (path.includes('/coach/')) return path.endsWith('/assignments') ? oldAssignments.promise : oldMemory.promise;
    return path.endsWith('/assignments') ? { assignments: [{ id: 'current assignment' }] } : memory('current memory');
  });
  const { rerender } = render(view('coach', 'alice'));
  rerender(view('tutor', 'alice'));
  await screen.findByText('current memory');
  await act(async () => {
    oldAssignments.resolve({ assignments: [{ id: 'old assignment' }] });
    oldMemory.resolve(memory('old memory'));
  });
  expect(screen.getByText('current assignment')).toBeVisible();
  expect(screen.getByText('current memory')).toBeVisible();
});

it('shows unconfigured memory as empty without a failure alert', async () => {
  DaylightAPI.mockImplementation(async path => {
    if (path.endsWith('/assignments')) return { assignments: [] };
    throw Object.assign(new Error('HTTP 501: not configured'), { status: 501 });
  });
  render(view('coach', 'alice'));
  expect(await screen.findByText('No memory entries')).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('retains the next member’s entries when a confirmed Clear All finishes late', async () => {
  const clearing = deferred();
  DaylightAPI.mockImplementation(async (path, body, method) => {
    if (method === 'DELETE') return clearing.promise;
    if (path.endsWith('/assignments')) return { assignments: [] };
    return memory(path.endsWith('/bob') ? 'Bob memory' : 'Alice memory');
  });
  const { rerender } = render(view('coach', 'alice'));
  await screen.findByText('Alice memory');
  fireEvent.click(screen.getByRole('button', { name: 'Clear All' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Clear All' }));
  rerender(view('coach', 'bob'));
  await screen.findByText('Bob memory');
  await act(async () => clearing.resolve({}));
  expect(screen.getByText('Bob memory')).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(DaylightAPI).toHaveBeenCalledWith('/api/v1/agents/coach/memory/alice', {}, 'DELETE');
});

it('reports a rejected deletion in the current view and can delete successfully on the next attempt', async () => {
  let removed = false;
  let attempts = 0;
  DaylightAPI.mockImplementation(async (path, body, method) => {
    if (method === 'DELETE') {
      if (!attempts++) throw new Error('Deletion refused');
      removed = true;
      return {};
    }
    if (path.endsWith('/assignments')) return { assignments: [] };
    return removed ? { entries: {} } : memory('Alice memory');
  });
  render(view('coach', 'alice'));
  await screen.findByText('Alice memory');
  const remove = screen.getByRole('button', { name: 'Delete memory entry note' });
  fireEvent.click(remove);
  expect(await screen.findByRole('alert')).toHaveTextContent('Deletion refused');
  fireEvent.click(remove);
  expect(await screen.findByText('No memory entries')).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
});
