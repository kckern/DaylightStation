import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));
import IntegrationsIndex from './IntegrationsIndex.jsx';

const integrationsPath = '/api/v1/admin/integrations';

function renderIndex() {
  return render(
    <MantineProvider>
      <MemoryRouter><IntegrationsIndex /></MemoryRouter>
    </MantineProvider>,
  );
}

describe('IntegrationsIndex', () => {
  beforeEach(() => { api.mockReset(); });

  it('renders the roster returned by the shared integrations resource', async () => {
    api.mockResolvedValue({
      integrations: [
        { provider: 'plex', category: 'media', url: 'https://plex.test', hasAuth: true },
        { provider: 'withings', category: 'fitness', hasAuth: false },
      ],
    });

    renderIndex();

    expect(await screen.findByRole('link', { name: /Plex/ })).toHaveAttribute('href', '/admin/system/integrations/plex');
    expect(screen.getByRole('link', { name: /Withings/ })).toHaveAttribute('href', '/admin/system/integrations/withings');
    expect(api.mock.calls).toEqual([[integrationsPath]]);
  });

  it('retries a failed roster read and waits for success before showing an empty list', async () => {
    api.mockRejectedValueOnce(new Error('Integrations unavailable')).mockResolvedValueOnce({ integrations: [] });

    renderIndex();
    expect(await screen.findByRole('alert')).toHaveTextContent('Integrations unavailable');
    expect(screen.queryByText('No integrations found.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No integrations found.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.mock.calls).toEqual([[integrationsPath], [integrationsPath]]);
  });
});
