import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MedicalView } from './MedicalView.jsx';

const apiMock = vi.fn();
vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));

it('removes a deleted reading from a replacement Medical view when its acknowledgement arrives', async () => {
  const removal = Promise.withResolvers();
  const reading = { id: 'one', date: '2026-09-05', value: 60, note: 'Earlier reading' };
  let metrics = [{ metric: 'resting_hr', readings: [reading], latest: reading }];
  apiMock.mockImplementation((path, _body, method) => {
    if (method === 'DELETE') return removal.promise.then(() => { metrics = []; });
    return Promise.resolve({ metrics });
  });
  vi.stubGlobal('confirm', () => true);
  try {
    const mount = () => render(<MantineProvider><MedicalView /></MantineProvider>);
    const first = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Resting Heart Rate on 2026-09-05, 60' }));
    expect(apiMock).toHaveBeenCalledWith('api/v1/health/medical/one', {}, 'DELETE');
    first.unmount();
    mount();
    await screen.findByText('Earlier reading');
    await act(async () => removal.resolve());
    expect(await screen.findByText('No medical readings yet')).toBeVisible();
  } finally { vi.unstubAllGlobals(); }
});

it('admits one delete per reading, then exposes an explicit retry after refusal', async () => {
  const firstDelete = Promise.withResolvers();
  const first = { id: 'one', date: '2026-09-05', value: 60, note: 'Earlier reading' };
  const second = { id: 'two', date: '2026-09-06', value: 62, note: 'Later reading' };
  const metrics = [{ metric: 'resting_hr', readings: [first, second], latest: second }];
  const confirmMock = vi.fn(() => true);
  let deleteCount = 0;
  apiMock.mockReset().mockImplementation((_path, _body, method) => {
    if (method === 'DELETE') {
      deleteCount += 1;
      return deleteCount === 1 ? firstDelete.promise : Promise.resolve({ removed: true });
    }
    return Promise.resolve({ metrics });
  });
  vi.stubGlobal('confirm', confirmMock);
  try {
    render(<MantineProvider><MedicalView /></MantineProvider>);
    const deleteFirst = await screen.findByRole('button', { name: 'Delete Resting Heart Rate on 2026-09-05, 60' });
    const deleteSecond = screen.getByRole('button', { name: 'Delete Resting Heart Rate on 2026-09-06, 62' });

    fireEvent.click(deleteFirst);
    fireEvent.click(deleteFirst);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(apiMock.mock.calls.filter(([, , method]) => method === 'DELETE')).toHaveLength(1);
    expect(deleteSecond).toBeEnabled();

    await act(async () => firstDelete.reject(new Error('write refused')));
    expect(await screen.findByRole('alert')).toHaveTextContent('write refused');
    expect(deleteFirst).toBeEnabled();

    fireEvent.click(deleteFirst);
    await act(async () => {});
    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(apiMock.mock.calls.filter(([, , method]) => method === 'DELETE')).toHaveLength(2);
  } finally { vi.unstubAllGlobals(); }
});
