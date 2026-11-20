import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';
import OfficeOff from './OfficeOff/OfficeOff.jsx';

vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

it('admits one automatic command under effect replay and closes through the latest owner', async () => {
  const request = Promise.withResolvers();
  DaylightAPI.mockClear().mockReturnValue(request.promise);
  const first = vi.fn();
  const current = vi.fn();
  const view = render(<StrictMode><OfficeOff clear={first} /></StrictMode>);
  await waitFor(() => expect(DaylightAPI).toHaveBeenCalledExactlyOnceWith('api/v1/home/office_tv/off'));
  view.rerender(<StrictMode><OfficeOff clear={current} /></StrictMode>);
  await act(async () => request.resolve({ ok: true }));

  expect(first).not.toHaveBeenCalled();
  expect(current).toHaveBeenCalledTimes(1);
  expect(DaylightAPI).toHaveBeenCalledTimes(1);
});

it('lets Close leave a pending action without applying the later acknowledgment', async () => {
  const request = Promise.withResolvers();
  DaylightAPI.mockClear().mockReturnValue(request.promise);
  const clear = vi.fn();
  render(<OfficeOff clear={clear} />);
  await waitFor(() => expect(DaylightAPI).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(clear).toHaveBeenCalledTimes(1);
  await act(async () => request.resolve({ ok: true }));
  expect(clear).toHaveBeenCalledTimes(1);
});
