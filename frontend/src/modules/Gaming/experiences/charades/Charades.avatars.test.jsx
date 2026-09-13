import { render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import Charades from './Charades.jsx';

vi.mock('@/hooks/useWebSocket.js', () => ({ useWebSocketSubscription: vi.fn() }));
vi.mock('@gaming/platform/api/sessionClient.js', () => ({
  fetchSession: vi.fn(async () => ({
    header: { revision: 1 },
    state: { competition: false, phase: 'performer-ready', performer_id: 'seat-a', round: 1, challenge_index: 0 },
    definition: { competition: false, rounds: 3 },
  })),
  sendRuleCommand: vi.fn(),
}));

it('renders member avatars in the real wheel while retaining seat IDs for performer selection', async () => {
  const { container } = render(<Charades sessionId="avatars" seats={[
    { id: 'seat-a', name: 'Alice', color: '#123456', members: [{ id: 'alice', name: 'Alice', avatar: '/api/v1/static/users/alice' }] },
    { id: 'seat-b', name: 'Bob', members: [{ id: 'bob', name: 'Bob', avatar: '/api/v1/static/users/bob' }] },
    { id: 'guest', name: 'Guest', members: [] },
  ]} />);
  await waitFor(() => expect(container.querySelector('.family-selector')).toHaveAttribute('data-selected-id', 'seat-a'));
  expect([...container.querySelectorAll('image.segment-avatar')].map(image => image.getAttribute('href'))).toEqual([
    '/api/v1/static/users/alice', '/api/v1/static/users/bob',
  ]);
  expect([...container.querySelectorAll('.segment-initials')].map(node => node.textContent)).toEqual(['G']);
});
