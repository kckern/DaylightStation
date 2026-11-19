import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resource } = vi.hoisted(() => ({ resource: vi.fn() }));
vi.mock('../../../lib/hooks/useApiResource.js', () => ({ useApiResource: (...args) => resource(...args) }));
import IntegrationsIndex from './IntegrationsIndex.jsx';

function renderIndex() {
  return render(
    <MantineProvider>
      <MemoryRouter><IntegrationsIndex /></MemoryRouter>
    </MantineProvider>,
  );
}

describe('IntegrationsIndex', () => {
  beforeEach(() => resource.mockReset());

  it('renders the roster returned by the shared integrations resource', async () => {
    resource.mockReturnValue({
      data: { integrations: [
        { provider: 'plex', category: 'media', url: 'https://plex.test', hasAuth: true },
        { provider: 'withings', category: 'fitness', hasAuth: false },
      ] },
      loading: false,
      error: null,
    });

    renderIndex();

    expect(await screen.findByText('Plex')).toBeInTheDocument();
    expect(screen.getByText('Withings')).toBeInTheDocument();
    expect(resource).toHaveBeenCalledWith('/api/v1/admin/integrations', { label: 'Integrations' });
  });

  it('lets the user dismiss a resource read error', async () => {
    resource.mockReturnValue({
      data: null,
      loading: false,
      error: new Error('Integrations unavailable'),
    });

    renderIndex();
    expect(await screen.findByRole('alert')).toHaveTextContent('Integrations unavailable');
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
