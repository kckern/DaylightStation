import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import SessionsIndex from './SessionsIndex.jsx';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));

it.each([
  { revocable: false, expected: 'Session management unavailable', absent: 'Nobody is signed in' },
  { revocable: true, expected: 'Nobody is signed in', absent: 'Session management unavailable' },
])('distinguishes the session store response with revocable=$revocable', async ({ revocable, expected, absent }) => {
  api.mockClear();
  api.mockResolvedValue({ revocable, sessions: [] });
  render(<MantineProvider><SessionsIndex /></MantineProvider>);
  expect(await screen.findByText(expected)).toBeVisible();
  expect(screen.queryByText(absent)).toBeNull();
  expect(api.mock.calls).toEqual([['api/v1/auth/sessions']]);
});

it('disables bulk sign-out during an individual revoke and re-enables it for the refreshed roster', async () => {
  const phone = { id: 'phone-1', username: 'Sam', userAgent: 'iPhone Safari/1' };
  const laptop = { id: 'laptop-1', username: 'Sam', userAgent: 'Linux Firefox/1' };
  let completeRevoke;
  const revoke = new Promise(resolve => { completeRevoke = resolve; });
  api.mockReset()
    .mockResolvedValueOnce({ revocable: true, sessions: [phone, laptop] })
    .mockReturnValueOnce(revoke)
    .mockResolvedValueOnce({ revocable: true, sessions: [laptop] });

  render(<MantineProvider><SessionsIndex /></MantineProvider>);
  const bulk = await screen.findByRole('button', { name: 'Sign out 2 others' });
  fireEvent.click(screen.getAllByRole('button', { name: 'Sign out', exact: true })[0]);
  expect(bulk).toBeDisabled();
  fireEvent.click(bulk);
  expect(api.mock.calls).toEqual([['api/v1/auth/sessions'], ['api/v1/auth/sessions/phone-1', {}, 'DELETE']]);

  completeRevoke({ revoked: true });
  expect(await screen.findByRole('button', { name: 'Sign out 1 other' })).toBeEnabled();
  expect(api.mock.calls[2]).toEqual(['api/v1/auth/sessions']);
});
