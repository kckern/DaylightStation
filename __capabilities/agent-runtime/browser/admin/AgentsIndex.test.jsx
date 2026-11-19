import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

    expect(await screen.findByText('coach')).toBeInTheDocument();
    expect(screen.getByText('Daily coach')).toBeInTheDocument();
    expect(apiState.calls).toEqual([['/api/v1/agents']]);
  });

  it('dismisses a failed roster read', async () => {
    apiState.resolve = async () => { throw new Error('Agents unavailable'); };

    renderIndex();

    expect(await screen.findByRole('alert')).toHaveTextContent('Agents unavailable');
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
