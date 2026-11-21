import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { HealthDisplayPreferencesProvider, useHealthDisplayPreferences } from "./HealthDisplayPreferences.jsx";
import HealthDisplaySettings from "./HealthDisplaySettings.jsx";

vi.mock("../../../../../frontend/src/lib/hooks/useApiResource.js", () => ({
  useApiResource: () => ({ error: new Error('cleanup unavailable'), reload: () => {} }),
}));

function Probe() {
  const { densityPlacement } = useHealthDisplayPreferences();
  return <output data-testid="placement">{densityPlacement}</output>;
}

const mount = (userId = 'test-user') => render(
  <MantineProvider><HealthDisplayPreferencesProvider userId={userId}>
    <HealthDisplaySettings /><Probe />
  </HealthDisplayPreferencesProvider></MantineProvider>,
);

beforeEach(() => localStorage.clear());

it('updates the mounted log and persists the chosen placement', () => {
  mount();
  expect(screen.getByTestId('placement').textContent).toBe('before');
  fireEvent.click(screen.getByLabelText('After food name'));
  expect(screen.getByTestId('placement').textContent).toBe('after');
  expect(JSON.parse(localStorage.getItem('health:display:test-user'))).toEqual({ densityPlacement: 'after' });
});

it('retains a choice for the same user while another user keeps the default', () => {
  localStorage.setItem('health:display:alice', JSON.stringify({ densityPlacement: 'after' }));
  const first = mount('alice');
  expect(screen.getByTestId('placement')).toHaveTextContent('after');
  first.unmount();
  mount('bob');
  expect(screen.getByTestId('placement')).toHaveTextContent('before');
});

it('falls back for corrupt or invalid stored preferences', () => {
  localStorage.setItem('health:display:test-user', '{bad json');
  const first = mount();
  expect(screen.getByTestId('placement')).toHaveTextContent('before');
  first.unmount();
  localStorage.setItem('health:display:test-user', JSON.stringify({ densityPlacement: 'beside' }));
  mount();
  expect(screen.getByTestId('placement')).toHaveTextContent('before');
});

it('updates mounted consumers when another tab changes the preference', () => {
  mount();
  localStorage.setItem('health:display:test-user', JSON.stringify({ densityPlacement: 'after' }));
  act(() => window.dispatchEvent(new StorageEvent('storage', {
    key: 'health:display:test-user',
    newValue: JSON.stringify({ densityPlacement: 'after' }),
    storageArea: window.localStorage,
  })));
  expect(screen.getByTestId('placement')).toHaveTextContent('after');
});

it('keeps a newer local choice when an earlier cross-tab notification arrives', () => {
  const key = 'health:display:test-user';
  const earlier = JSON.stringify({ densityPlacement: 'before' });
  mount();
  localStorage.setItem(key, earlier);
  fireEvent.click(screen.getByLabelText('After food name'));
  act(() => window.dispatchEvent(new StorageEvent('storage', {
    key, newValue: earlier, storageArea: window.localStorage,
  })));
  expect(screen.getByTestId('placement')).toHaveTextContent('after');
  expect(JSON.parse(localStorage.getItem(key)).densityPlacement).toBe('after');
});

it('retains the current tab’s selection when the browser refuses persistence', () => {
  mount();
  const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Unavailable'); });
  try {
    fireEvent.click(screen.getByLabelText('After food name'));
    expect(screen.getByTestId('placement')).toHaveTextContent('after');
    expect(localStorage.getItem('health:display:test-user')).toBeNull();
  } finally { write.mockRestore(); }
});

it('resets the placement when another tab clears local storage', () => {
  localStorage.setItem('health:display:test-user', JSON.stringify({ densityPlacement: 'after' }));
  mount();
  expect(screen.getByTestId('placement')).toHaveTextContent('after');

  act(() => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { storageArea: window.localStorage }));
  });

  expect(screen.getByTestId('placement')).toHaveTextContent('before');
});

it('ignores changes to the same key in session storage', () => {
  mount();
  act(() => window.dispatchEvent(new StorageEvent('storage', {
    key: 'health:display:test-user',
    newValue: JSON.stringify({ densityPlacement: 'after' }),
    storageArea: window.sessionStorage,
  })));
  expect(screen.getByTestId('placement')).toHaveTextContent('before');
});

it('keeps both display choices available when cleanup settings fail', async () => {
  const { HealthSettings } = await import("../cleanup/HealthSettings.jsx");
  render(<MantineProvider><MemoryRouter><HealthDisplayPreferencesProvider userId="test-user">
    <HealthSettings />
  </HealthDisplayPreferencesProvider></MemoryRouter></MantineProvider>);
  expect(screen.getByLabelText('Before food name')).toBeTruthy();
  expect(screen.getByLabelText('After food name')).toBeTruthy();
  expect(screen.getByText(/cleanup unavailable/i)).toBeTruthy();
});
