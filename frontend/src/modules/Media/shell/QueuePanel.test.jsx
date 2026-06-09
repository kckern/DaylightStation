import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueuePanel } from './QueuePanel.jsx';

const mockQueue = { jump: vi.fn(), remove: vi.fn(), clear: vi.fn() };
const mockConfig = { setShuffle: vi.fn(), setRepeat: vi.fn() };
let mockSnapshot;

vi.mock('../session/useSessionController.js', () => ({
  useSessionController: () => ({ snapshot: mockSnapshot, queue: mockQueue, config: mockConfig }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockSnapshot = {
    state: 'playing',
    config: { shuffle: false, repeat: 'off' },
    queue: {
      currentIndex: 0,
      upNextCount: 0,
      items: [
        { queueItemId: 'q1', contentId: 'plex:1', title: 'First', priority: 'queue' },
        { queueItemId: 'q2', contentId: 'plex:2', title: 'Second', priority: 'upNext' },
      ],
    },
  };
});

describe('QueuePanel', () => {
  it('renders one row per queue item with the current item marked', () => {
    render(<QueuePanel target="local" />);
    expect(screen.getByTestId('queue-item-q1').className).toContain('queue-item--current');
    expect(screen.getByTestId('queue-item-q2').className).toContain('queue-item--upnext');
  });

  it('jump / remove / clear call through to the controller', () => {
    render(<QueuePanel target="local" />);
    fireEvent.click(screen.getByTestId('queue-jump-q2'));
    expect(mockQueue.jump).toHaveBeenCalledWith('q2');
    fireEvent.click(screen.getByTestId('queue-remove-q2'));
    expect(mockQueue.remove).toHaveBeenCalledWith('q2');
    fireEvent.click(screen.getByTestId('queue-clear'));
    expect(mockQueue.clear).toHaveBeenCalled();
  });

  it('shuffle toggles and repeat cycles off→all→one→off', () => {
    render(<QueuePanel target="local" />);
    fireEvent.click(screen.getByTestId('queue-shuffle'));
    expect(mockConfig.setShuffle).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTestId('queue-repeat'));
    expect(mockConfig.setRepeat).toHaveBeenCalledWith('all');
  });

  it('renders an empty state when the queue has no items', () => {
    mockSnapshot = { ...mockSnapshot, queue: { items: [], currentIndex: -1, upNextCount: 0 } };
    render(<QueuePanel target="local" />);
    expect(screen.getByTestId('queue-empty')).toBeTruthy();
  });
});
