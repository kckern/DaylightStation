// @vitest-environment jsdom
import React, { useEffect, useState } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DaylightAPI } from '../../lib/api.mjs';
import { setToken } from '../../lib/auth.js';
import PhoneServiceAuth from './PhoneServiceAuth.jsx';

vi.mock('./LoginScreen.jsx', () => ({
  default: ({ onLogin }) => <button onClick={() => { setToken('fresh'); onLogin(); }}>Sign in</button>,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.daylight;
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});

it('signs in at the expired phone destination, then reloads its data at the same URL', async () => {
  window.history.replaceState({}, '', '/health?capture=barcode');
  window.daylight = { deviceId: 'phone' };
  setToken('expired');
  const fetch = vi.fn(async (_url, options) => options.headers.Authorization === 'Bearer fresh'
    ? new Response('{"name":"Health"}') : new Response('', { status: 401 }));
  vi.stubGlobal('fetch', fetch);

  function Health() {
    const [name, setName] = useState('');
    useEffect(() => { DaylightAPI('/api/v1/health/context').then(data => setName(data.name)).catch(() => {}); }, []);
    return name;
  }

  const reload = vi.spyOn(window.history, 'go').mockImplementation(() => {});
  const firstPage = render(<PhoneServiceAuth><Health /></PhoneServiceAuth>);
  const signIn = await screen.findByRole('button', { name: 'Sign in' });
  await act(async () => signIn.click());
  expect(reload).toHaveBeenCalledWith(0);
  firstPage.unmount();
  render(<PhoneServiceAuth><Health /></PhoneServiceAuth>);
  expect(await screen.findByText('Health')).toBeTruthy();
  expect(window.location.pathname + window.location.search).toBe('/health?capture=barcode');
  expect(fetch).toHaveBeenCalledTimes(2);
});
