// tests/unit/content/capabilities/Queueable.test.mjs
import { describe, test, expect } from 'vitest';
import { QueueableItem } from '#domains/content/capabilities/Queueable.mjs';

describe('Queueable capability', () => {
  test('creates queueable item with traversal mode', () => {
    const item = new QueueableItem({
      id: 'folder:morning-program',
      source: 'folder',
      title: 'Morning Program',
      traversalMode: 'sequential',
      isQueueContainer: true
    });

    expect(item.traversalMode).toBe('sequential');
    expect(item.isQueueContainer).toBe(true);
  });

  test('defaults traversalMode to sequential', () => {
    const item = new QueueableItem({
      id: 'plex:12345',
      source: 'plex',
      title: 'TV Show',
      isQueueContainer: true
    });

    expect(item.traversalMode).toBe('sequential');
  });

  test('supports shuffle mode', () => {
    const item = new QueueableItem({
      id: 'filesystem:music/playlist',
      source: 'filesystem',
      title: 'Playlist',
      traversalMode: 'shuffle',
      isQueueContainer: true
    });

    expect(item.traversalMode).toBe('shuffle');
  });

  test('supports heuristic mode for smart selection', () => {
    const item = new QueueableItem({
      id: 'folder:daily-programming',
      source: 'folder',
      title: 'Daily Programming',
      traversalMode: 'heuristic',
      isQueueContainer: true
    });

    expect(item.traversalMode).toBe('heuristic');
  });
});
