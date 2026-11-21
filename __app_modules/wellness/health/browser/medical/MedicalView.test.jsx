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
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(apiMock).toHaveBeenCalledWith('api/v1/health/medical/one', {}, 'DELETE');
    first.unmount();
    mount();
    await screen.findByText('Earlier reading');
    await act(async () => removal.resolve());
    expect(await screen.findByText('No medical readings yet')).toBeVisible();
  } finally { vi.unstubAllGlobals(); }
});
