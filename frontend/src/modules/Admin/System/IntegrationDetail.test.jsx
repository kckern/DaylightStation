import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

const resource = vi.fn();
const hook = { testConnection: vi.fn(), error: null, clearError: vi.fn() };
vi.mock('../../../hooks/admin/useAdminIntegrations.js', () => ({ useAdminIntegrations: () => hook }));
vi.mock('../../../lib/hooks/useApiResource.js', () => ({ useApiResource: (...args) => resource(...args) }));
const { notifySuccess, notifyFailure } = vi.hoisted(() => ({ notifySuccess: vi.fn(), notifyFailure: vi.fn() }));
vi.mock('../shared/feedback.js', () => ({ notifySuccess, notifyFailure }));
import IntegrationDetail from './IntegrationDetail.jsx';

function ProviderSwitcher() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/admin/system/integrations/plex')}>Open Plex</button>;
}

const renderAt = (provider) => render(
  <MantineProvider>
    <MemoryRouter initialEntries={[`/admin/system/integrations/${provider}`]}>
      <ProviderSwitcher />
      <Routes>
        <Route path="/admin/system/integrations/:provider" element={<IntegrationDetail />} />
      </Routes>
    </MemoryRouter>
  </MantineProvider>
);

beforeEach(() => {
  resource.mockReset();
  hook.testConnection = vi.fn();
  notifySuccess.mockReset();
  notifyFailure.mockReset();
});

describe('IntegrationDetail reconnect', () => {
  it('links Withings to the OAuth connect route', async () => {
    resource.mockReturnValue({ data: { integration: { provider: 'withings', category: 'fitness' } }, loading: false, error: null, reload: vi.fn() });
    renderAt('withings');
    const link = await screen.findByRole('link', { name: 'Reconnect Withings' });
    expect(link).toHaveAttribute('href', '/api/v1/admin/oauth/withings/connect');
    expect(screen.getByRole('button', { name: /Test Connection/ })).toBeInTheDocument();
  });

  it('keeps the reconnect link when Withings is not a listed integration', async () => {
    // A plain function: vitest reports a vi.fn's rejected promise as a test
    // failure even when the component catches it.
    resource.mockReturnValue({ data: null, loading: false, error: Object.assign(new Error('Provider "withings" not found'), { status: 404 }), reload: vi.fn() });
    renderAt('withings');
    expect(await screen.findByRole('link', { name: 'Reconnect Withings' })).toBeInTheDocument();
  });

  it('shows no reconnect link for other providers', async () => {
    resource.mockReturnValue({ data: { integration: { provider: 'plex', category: 'media' } }, loading: false, error: null, reload: vi.fn() });
    renderAt('plex');
    await screen.findByRole('button', { name: /Test Connection/ });
    expect(screen.queryByRole('link', { name: /Reconnect/ })).toBeNull();
  });

  it('does not show connection feedback after navigating to another provider', async () => {
    let finishTest;
    hook.testConnection.mockReturnValue(new Promise(resolve => { finishTest = resolve; }));
    resource.mockImplementation(path => ({
      data: { integration: { provider: path.endsWith('/plex') ? 'plex' : 'withings', category: 'media' } },
      loading: false,
      error: null,
      reload: vi.fn(),
    }));

    renderAt('withings');
    fireEvent.click(await screen.findByRole('button', { name: 'Test Connection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Plex' }));
    await waitFor(() => expect(resource).toHaveBeenCalledWith('/api/v1/admin/integrations/plex'));

    await act(async () => finishTest({ status: 'success', message: 'reachable' }));

    expect(notifySuccess).not.toHaveBeenCalled();
    expect(notifyFailure).not.toHaveBeenCalled();
  });
});
