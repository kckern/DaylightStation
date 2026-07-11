// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, renderHook, act } from '@testing-library/react';
import React from 'react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { useLifeUser } from '#frontend/modules/Life/hooks/useLifeUser.js';
import LifeApp from '#frontend/Apps/LifeApp.jsx';

const jsonResponse = (body) => ({ ok: true, status: 200, json: async () => body });

/**
 * Route the fetch mock by URL. /life/user echoes back the ?username= (or the
 * default head-of-household) so we can assert the switcher re-resolves the user.
 */
const mockLifeApi = (users = [{ username: 'test-user', displayName: 'Head User' }, { username: 'test-user-2', displayName: 'Second User' }]) => {
  fetch.mockImplementation((url) => {
    if (url.includes('/life/users')) return Promise.resolve(jsonResponse({ users }));
    if (url.includes('/life/user')) {
      const m = /[?&]username=([^&]+)/.exec(url);
      const username = m ? decodeURIComponent(m[1]) : 'test-user';
      const match = users.find((u) => u.username === username);
      return Promise.resolve(jsonResponse({ username, displayName: match?.displayName || username }));
    }
    return Promise.resolve(jsonResponse({}));
  });
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  try { localStorage.clear(); } catch { /* noop */ }
});

describe('useLifeUser household switching', () => {
  it('resolves the default user and loads the roster', async () => {
    mockLifeApi();
    const { result } = renderHook(() => useLifeUser());

    await waitFor(() => expect(result.current.user?.username).toBe('test-user'));
    expect(result.current.users).toHaveLength(2);
    expect(result.current.users[1]).toEqual({ username: 'test-user-2', displayName: 'Second User' });
  });

  it('setUsername persists to localStorage and re-resolves the user', async () => {
    mockLifeApi();
    const { result } = renderHook(() => useLifeUser());
    await waitFor(() => expect(result.current.user?.username).toBe('test-user'));

    act(() => { result.current.setUsername('test-user-2'); });

    await waitFor(() => expect(result.current.user?.username).toBe('test-user-2'));
    expect(localStorage.getItem('life.username')).toBe('test-user-2');
    // The re-resolve fetch carried the selected username.
    expect(fetch.mock.calls.some(([u]) => u.includes('/life/user?username=test-user-2'))).toBe(true);
  });

  it('honors a pre-existing localStorage selection on first load', async () => {
    localStorage.setItem('life.username', 'test-user-2');
    mockLifeApi();
    const { result } = renderHook(() => useLifeUser());

    await waitFor(() => expect(result.current.user?.username).toBe('test-user-2'));
  });
});

describe('LifeApp header switcher', () => {
  it('renders the switcher with member display names in a multi-user household', async () => {
    mockLifeApi();
    render(
      <MemoryRouter initialEntries={['/now']}>
        <LifeApp />
      </MemoryRouter>
    );

    const select = await screen.findByRole('textbox', { name: 'Switch household member' });
    expect(select).toBeTruthy();
    // Mantine Select shows the resolved user's display name as its value.
    await waitFor(() => expect(select.value).toBe('Head User'));
  });

  it('hides the switcher for a single-member household', async () => {
    mockLifeApi([{ username: 'test-user', displayName: 'Head User' }]);
    render(
      <MemoryRouter initialEntries={['/now']}>
        <LifeApp />
      </MemoryRouter>
    );

    // Wait for the roster fetch to settle, then assert no switcher.
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => u.includes('/life/users'))).toBe(true));
    expect(screen.queryByRole('textbox', { name: 'Switch household member' })).toBeNull();
  });
});
