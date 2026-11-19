import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { clearToken, setToken } from '../../../lib/auth.js';
import SessionsIndex, { SessionRevocationProvider } from './SessionsIndex.jsx';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));

const renderSessions = () => render(
  <MantineProvider><SessionRevocationProvider><SessionsIndex /></SessionRevocationProvider></MantineProvider>,
);
const phone = { id: 'phone-1', username: 'Sam', userAgent: 'iPhone Safari/1' };
const laptop = { id: 'laptop-1', username: 'Sam', userAgent: 'Linux Firefox/1' };

it.each([
  { revocable: false, expected: 'Session management unavailable', absent: 'Nobody is signed in' },
  { revocable: true, expected: 'Nobody is signed in', absent: 'Session management unavailable' },
])('distinguishes the session store response with revocable=$revocable', async ({ revocable, expected, absent }) => {
  api.mockClear();
  api.mockResolvedValue({ revocable, sessions: [] });
  renderSessions();
  expect(await screen.findByText(expected)).toBeVisible();
  expect(screen.queryByText(absent)).toBeNull();
  expect(api.mock.calls).toEqual([['api/v1/auth/sessions']]);
});

it('disables bulk sign-out during an individual revoke and re-enables it for the refreshed roster', async () => {
  let completeRevoke;
  const revoke = new Promise(resolve => { completeRevoke = resolve; });
  api.mockReset()
    .mockResolvedValueOnce({ revocable: true, sessions: [phone, laptop] })
    .mockReturnValueOnce(revoke)
    .mockResolvedValueOnce({ revocable: true, sessions: [laptop] });

  renderSessions();
  const bulk = await screen.findByRole('button', { name: 'Sign out 2 others' });
  const [individual] = screen.getAllByRole('button', { name: 'Sign out', exact: true });
  act(() => {
    individual.click();
    bulk.click();
  });
  expect(bulk).toBeDisabled();
  expect(api.mock.calls).toEqual([['api/v1/auth/sessions'], ['api/v1/auth/sessions/phone-1', {}, 'DELETE']]);

  completeRevoke({ revoked: true });
  expect(await screen.findByRole('button', { name: 'Sign out 1 other' })).toBeEnabled();
  expect(api.mock.calls[2]).toEqual(['api/v1/auth/sessions']);
});

it('keeps the roster on refusal and supports a later sign-out attempt', async () => {
  api.mockReset()
    .mockResolvedValueOnce({ revocable: true, sessions: [phone] })
    .mockRejectedValueOnce(new Error('Sign-out refused'))
    .mockResolvedValueOnce({ removed: 1 })
    .mockResolvedValueOnce({ revocable: true, sessions: [] });

  renderSessions();
  const bulk = await screen.findByRole('button', { name: 'Sign out 1 other' });
  const individual = screen.getByRole('button', { name: 'Sign out', exact: true });
  act(() => {
    bulk.click();
    individual.click();
  });
  expect(await screen.findByRole('status')).toHaveTextContent('Sign-out refused');
  expect(api).toHaveBeenCalledTimes(2);
  expect(individual).toBeEnabled();
  expect(bulk).toBeEnabled();
  fireEvent.click(bulk);
  expect(await screen.findByText('Nobody is signed in')).toBeVisible();
  expect(await screen.findByText('Signed out everywhere else.')).toBeVisible();
  expect(api.mock.calls).toEqual([
    ['api/v1/auth/sessions'],
    ['api/v1/auth/sessions/others', {}, 'DELETE'],
    ['api/v1/auth/sessions/others', {}, 'DELETE'],
    ['api/v1/auth/sessions'],
  ]);
});

it('releases the old revoke on an auth change without clearing the new revoke when the old one resolves', async () => {
  const oldRevoke = Promise.withResolvers();
  const newRevoke = Promise.withResolvers();
  api.mockReset()
    .mockResolvedValueOnce({ revocable: true, sessions: [phone] })
    .mockReturnValueOnce(oldRevoke.promise)
    .mockResolvedValueOnce({ revocable: true, sessions: [laptop] })
    .mockReturnValueOnce(newRevoke.promise)
    .mockResolvedValueOnce({ revocable: true, sessions: [] });

  setToken('test-session-token');
  renderSessions();
  fireEvent.click(await screen.findByRole('button', { name: 'Sign out', exact: true }));
  act(() => clearToken());
  const individual = await screen.findByRole('button', { name: 'Sign out', exact: true });
  expect(individual).toBeEnabled();
  fireEvent.click(individual);
  await act(async () => { oldRevoke.resolve({ revoked: true }); });
  expect(individual).toBeDisabled();
  expect(screen.queryByText('Signed out iPhone · Safari.')).toBeNull();
  expect(api).toHaveBeenCalledTimes(4);

  await act(async () => { newRevoke.resolve({ revoked: true }); });
  expect(await screen.findByText('Signed out Linux · Firefox.')).toBeVisible();
  expect(api.mock.calls).toEqual([
    ['api/v1/auth/sessions'],
    ['api/v1/auth/sessions/phone-1', {}, 'DELETE'],
    ['api/v1/auth/sessions'],
    ['api/v1/auth/sessions/laptop-1', {}, 'DELETE'],
    ['api/v1/auth/sessions'],
  ]);
});

it('reads the new account roster without joining an old account request', async () => {
  const oldRoster = Promise.withResolvers();
  api.mockReset()
    .mockReturnValueOnce(oldRoster.promise)
    .mockResolvedValueOnce({ revocable: true, sessions: [{ ...laptop, current: true }] });

  setToken('old-session-token');
  const { unmount } = renderSessions();
  expect(api).toHaveBeenCalledTimes(1);
  act(() => setToken('new-session-token'));
  expect(api.mock.calls).toEqual([['api/v1/auth/sessions'], ['api/v1/auth/sessions']]);
  expect(await screen.findByRole('row', { name: /this device.*Linux/ })).toBeVisible();

  await act(async () => { oldRoster.resolve({ revocable: true, sessions: [{ ...phone, current: true }] }); });
  expect(screen.queryByText('iPhone · Safari')).toBeNull();
  expect(screen.getByRole('button', { name: 'Sign out here' })).toBeVisible();
  unmount();
  clearToken();
});
