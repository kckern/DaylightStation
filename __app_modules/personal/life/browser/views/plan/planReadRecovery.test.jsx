import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { DaylightAPI } from '../../../../../../frontend/src/lib/api.mjs';
import { BeliefsView } from './BeliefsView.jsx';
import { CeremonyConfig } from './CeremonyConfig.jsx';

vi.mock('../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

function page(path, user = 'amy') {
  return <MantineProvider><MemoryRouter initialEntries={['/life/plan/' + path]}>
    <Routes key={user}>
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
  const config = { timezone: 'test', ceremonies: { unit_intention: { enabled: true, notes: 'keep' } } };
  const updated = { ...config, ceremonies: { unit_intention: { enabled: false, notes: 'keep' } } };
  DaylightAPI.mockReset()
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce({ config })
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new Error('Refresh failed'))
    .mockResolvedValueOnce({ config: updated });
  render(page('ceremonies'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Ceremonies failed to load');
  expect(screen.queryByRole('switch')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  fireEvent.click((await screen.findAllByRole('switch'))[0]);
  expect(await screen.findByRole('alert')).toHaveTextContent('Refresh failed');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect((await screen.findAllByRole('switch'))[0]).not.toBeChecked();
  expect(DaylightAPI.mock.calls.filter(([, , method]) => method === 'PATCH')).toEqual([
    ['/api/v1/life/plan/cadence?username=amy', updated, 'PATCH'],
  ]);
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
