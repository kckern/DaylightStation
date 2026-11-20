import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { DaylightAPI } from '../../../../../../frontend/src/lib/api.mjs';
import { resetApiResourceCache } from '@/lib/hooks/useApiResource.js';
import { PurposeView } from './PurposeView.jsx';
import { BeliefsView } from './BeliefsView.jsx';
import { CeremonyConfig } from './CeremonyConfig.jsx';

vi.mock('../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

beforeEach(() => resetApiResourceCache());

function page(path, user = 'amy') {
  return <MantineProvider><MemoryRouter initialEntries={['/life/plan/' + path]}>
    <Routes key={user}>
      <Route path="/life/plan/purpose" element={<PurposeView username={user} />} />
      <Route path="/life/plan/beliefs" element={<BeliefsView username={user} />} />
      <Route path="/life/plan/ceremonies" element={<CeremonyConfig username={user} />} />
    </Routes>
  </MemoryRouter></MantineProvider>;
}

it('retries beliefs, retains a rejected creation draft, and shows the committed list after save', async () => {
  const saved = { id: 'b', if_hypothesis: 'Practice' };
  DaylightAPI.mockReset()
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValueOnce({ beliefs: [] })
    .mockRejectedValueOnce(new Error('Rejected'))
    .mockResolvedValueOnce(saved)
    .mockResolvedValueOnce({ beliefs: [saved] });
  render(page('beliefs'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Beliefs failed to load');
  expect(screen.queryByText(/No beliefs defined/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText(/No beliefs defined/);
  fireEvent.click(screen.getByRole('button', { name: 'Add belief' }));
  fireEvent.change(await screen.findByPlaceholderText('practice piano every morning'), { target: { value: 'Practice' } });
  fireEvent.change(screen.getByPlaceholderText("I'll be recital-ready by spring"), { target: { value: 'Improve' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create belief' }));
  await screen.findByText('Rejected');
  expect(screen.getByPlaceholderText('practice piano every morning')).toHaveValue('Practice');
  fireEvent.click(screen.getByRole('button', { name: 'Create belief' }));
  expect(await screen.findByText('If Practice')).toBeVisible();
  expect(DaylightAPI).toHaveBeenCalledWith('/api/v1/life/plan/beliefs?username=amy', { if_hypothesis: 'Practice', then_outcome: 'Improve' }, 'POST');
});

it('requires a successful cadence read before a toggle and retries a failed post-commit read without rewriting', async () => {
  const config = { timezone: 'test' };
  const ceremonies = { unit_intention: { enabled: true, notes: 'keep' } };
  const updated = { unit_intention: { enabled: false, notes: 'keep' } };
  DaylightAPI.mockReset()
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce({ config, ceremonies })
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new Error('Refresh failed'))
    .mockResolvedValueOnce({ config, ceremonies: updated });
  render(page('ceremonies'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Ceremonies failed to load');
  expect(screen.queryByRole('switch')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  fireEvent.click((await screen.findAllByRole('switch'))[0]);
  expect(await screen.findByRole('alert')).toHaveTextContent('Refresh failed');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect((await screen.findAllByRole('switch'))[0]).not.toBeChecked();
  expect(DaylightAPI.mock.calls.filter(([, , method]) => method === 'PATCH')).toEqual([
    ['/api/v1/life/plan/ceremonies/unit_intention?username=amy', { enabled: false }, 'PATCH'],
  ]);
});

it('saves two ceremony switches independently when the second commits first', async () => {
  const ceremonies = {
    unit_intention: { enabled: true, at: '08:00' }, unit_capture: { enabled: true, at: '20:00' },
  };
  const pending = [];
  DaylightAPI.mockReset().mockImplementation((url, input, method) => {
    if (method !== 'PATCH') return Promise.resolve({ ceremonies: structuredClone(ceremonies) });
    const type = url.split('?')[0].split('/').at(-1);
    return new Promise(resolve => pending.push(() => {
      if (Object.hasOwn(ceremonies, type)) Object.assign(ceremonies[type], input);
      resolve({});
    }));
  });
  render(page('ceremonies'));
  const [intention, capture] = await screen.findAllByRole('switch');
  fireEvent.click(intention);
  fireEvent.click(capture);
  expect(DaylightAPI.mock.calls.filter(([, , method]) => method === 'PATCH')).toEqual([
    ['/api/v1/life/plan/ceremonies/unit_intention?username=amy', { enabled: false }, 'PATCH'],
    ['/api/v1/life/plan/ceremonies/unit_capture?username=amy', { enabled: false }, 'PATCH'],
  ]);
  await act(async () => pending[1]());
  expect(capture).not.toBeChecked();
  expect(intention).toBeChecked();
  await act(async () => pending[0]());
  expect(intention).not.toBeChecked();
  expect(capture).not.toBeChecked();
  expect(ceremonies).toEqual({
    unit_intention: { enabled: false, at: '08:00' }, unit_capture: { enabled: false, at: '20:00' },
  });
});

it('keeps an acknowledged switch guarded if another write supersedes its readback', async () => {
  const ceremonies = { unit_intention: { enabled: true }, unit_capture: { enabled: true } };
  const writes = [];
  const readbacks = [];
  DaylightAPI.mockReset().mockResolvedValueOnce({ ceremonies }).mockImplementation((url, _, method) => {
    const pending = Promise.withResolvers();
    if (method === 'PATCH') writes.push(pending);
    else readbacks.push(pending);
    return pending.promise;
  });
  render(page('ceremonies'));
  const intention = await screen.findByRole('switch', { name: 'Unit Intention' });
  const capture = screen.getByRole('switch', { name: 'Daily Capture' });
  fireEvent.click(intention);
  fireEvent.click(capture);
  await act(async () => writes[0].resolve({}));
  await waitFor(() => expect(readbacks).toHaveLength(1));
  await act(async () => writes[1].resolve({}));
  await waitFor(() => expect(readbacks).toHaveLength(2));

  expect(intention).toBeChecked();
  expect(intention).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(intention);
  expect(writes).toHaveLength(2);
  const confirmed = { ceremonies: { unit_intention: { enabled: false }, unit_capture: { enabled: false } } };
  await act(async () => readbacks[1].resolve(confirmed));
  await act(async () => readbacks[0].resolve(ceremonies));
  expect(intention).not.toBeChecked();
  expect(capture).not.toBeChecked();
  expect(intention).toHaveAttribute('aria-disabled', 'false');
});

it.each(['beliefs', 'ceremonies'])('discards a late failed %s read after switching household members', async path => {
  let rejectOld;
  DaylightAPI.mockReset().mockImplementation(url => url.endsWith('=amy')
    ? new Promise((_, reject) => { rejectOld = reject; })
    : Promise.resolve(path === 'beliefs' ? { beliefs: [] } : { config: { ceremonies: {} } }));
  const view = render(page(path));
  await waitFor(() => expect(rejectOld).toBeTypeOf('function'));
  view.rerender(page(path, 'bob'));
  if (path === 'beliefs') await screen.findByText(/No beliefs defined/);
  else await screen.findAllByRole('switch');
  await act(async () => rejectOld(new Error('Old member failure')));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('offers a read retry when a saved purpose cannot be reloaded', async () => {
  const purpose = { statement: 'Practice' };
  DaylightAPI.mockReset()
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce(purpose)
    .mockRejectedValueOnce(new Error('Refresh failed'))
    .mockResolvedValueOnce({ purpose });
  render(page('purpose'));
  fireEvent.click(await screen.findByTestId('edit'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Practice' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Refresh failed');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Practice')).toBeVisible();
  expect(DaylightAPI.mock.calls.filter(([, , method]) => method === 'POST')).toEqual([
    ['/api/v1/life/plan/purpose?username=amy', purpose, 'POST'],
  ]);
});
