import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const fetchDetail = vi.fn();
const resource = vi.fn();
const hook = { fetchDetail, testConnection: vi.fn(), error: null, clearError: vi.fn() };
vi.mock('../../../hooks/admin/useAdminIntegrations.js', () => ({ useAdminIntegrations: () => hook }));
vi.mock('../../../lib/hooks/useApiResource.js', () => ({ useApiResource: (...args) => resource(...args) }));
import IntegrationDetail from './IntegrationDetail.jsx';

const renderAt = (provider) => render(
  <MantineProvider>
    <MemoryRouter initialEntries={[`/admin/system/integrations/${provider}`]}>
      <Routes>
        <Route path="/admin/system/integrations/:provider" element={<IntegrationDetail />} />
      </Routes>
    </MemoryRouter>
  </MantineProvider>
);

beforeEach(() => { fetchDetail.mockReset(); resource.mockReset(); hook.fetchDetail = fetchDetail; });

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
});
