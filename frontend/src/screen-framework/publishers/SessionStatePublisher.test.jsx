import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../../services/WebSocketService.js', () => ({
  wsService: { send: vi.fn() },
}));

import { wsService } from '../../services/WebSocketService.js';
import { SessionStatePublisher } from './SessionStatePublisher.jsx';

describe('SessionStatePublisher (standalone)', () => {
  beforeEach(() => wsService.send.mockClear());

  it('publishes initial device-state when deviceId is present', () => {
    render(<SessionStatePublisher deviceId="tv-1" />);
    const initialCalls = wsService.send.mock.calls.filter(
      ([m]) => m?.topic === 'device-state' && m.reason === 'initial',
    );
    expect(initialCalls.length).toBeGreaterThanOrEqual(1);
    expect(initialCalls[0][0].deviceId).toBe('tv-1');
  });

  it('renders nothing and publishes nothing when deviceId is missing', () => {
    const { container } = render(<SessionStatePublisher />);
    expect(container.firstChild).toBeNull();
    const stateCalls = wsService.send.mock.calls.filter(
      ([m]) => m?.topic === 'device-state',
    );
    expect(stateCalls.length).toBe(0);
  });
});
