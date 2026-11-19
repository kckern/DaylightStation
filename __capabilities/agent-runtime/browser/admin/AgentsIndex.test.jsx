import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiState } = vi.hoisted(() => ({ apiState: { calls: [], resolve: null } }));
vi.mock('../../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: (...args) => {
    apiState.calls.push(args);
    return apiState.resolve(...args);
  },
}));
import AgentsIndex from './AgentsIndex.jsx';

function renderIndex() {
  return render(
    <MantineProvider>
      <MemoryRouter><AgentsIndex /></MemoryRouter>
    </MantineProvider>,
  );
}

describe('AgentsIndex', () => {
  beforeEach(() => { apiState.calls = []; apiState.resolve = null; });

  it('loads the agent directory through its shared resource hook', async () => {
    apiState.resolve = async () => ({ agents: [{ id: 'coach', description: 'Daily coach' }] });

    renderIndex();

    expect(await screen.findByRole('link', { name: /coach/ })).toHaveAttribute('href', '/admin/agents/coach');
    expect(screen.getByText('Daily coach')).toBeInTheDocument();
    expect(apiState.calls).toEqual([['/api/v1/agents']]);
  });

  it('offers a retry for an unavailable directory and shows empty only after a successful read', async () => {
    apiState.resolve = async () => { throw new Error('Agents unavailable'); };

    renderIndex();

    expect(await screen.findByRole('alert')).toHaveTextContent('Agents unavailable');
    expect(screen.queryByText('No agents registered')).toBeNull();
    apiState.resolve = async () => ({ agents: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No agents registered')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(apiState.calls).toEqual([['/api/v1/agents'], ['/api/v1/agents']]);
  });
});
