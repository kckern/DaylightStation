import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { HealthDisplayPreferencesProvider, useHealthDisplayPreferences } from './HealthDisplayPreferences.jsx';
import HealthDisplaySettings from './HealthDisplaySettings.jsx';

vi.mock('../../../lib/hooks/useApiResource.js', () => ({
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
  screen.getByLabelText('After food name').click();
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
  act(() => window.dispatchEvent(new StorageEvent('storage', {
    key: 'health:display:test-user', newValue: JSON.stringify({ densityPlacement: 'after' }),
  })));
  expect(screen.getByTestId('placement')).toHaveTextContent('after');
});

it('keeps both display choices available when cleanup settings fail', async () => {
  const { HealthSettings } = await import('../cleanup/HealthSettings.jsx');
  render(<MantineProvider><HealthDisplayPreferencesProvider userId="test-user">
    <HealthSettings />
  </HealthDisplayPreferencesProvider></MantineProvider>);
  expect(screen.getByLabelText('Before food name')).toBeTruthy();
  expect(screen.getByLabelText('After food name')).toBeTruthy();
  expect(screen.getByText(/cleanup unavailable/i)).toBeTruthy();
});
