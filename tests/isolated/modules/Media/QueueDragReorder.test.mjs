import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';

afterEach(async () => {
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});

describe('QueueItem drag-to-reorder', () => {
  it('renders a drag handle element', async () => {
    const { render } = await import('@testing-library/react');
    const { default: QueueItem } = await import('#frontend/modules/Media/QueueItem.jsx');
    const item = { queueId: 'a1', contentId: 'plex:1', title: 'Test' };
    const { container } = render(
      React.createElement(QueueItem, {
        item, isCurrent: false, onPlay: () => {}, onRemove: () => {},
        index: 0, onDragStart: () => {}, onDrop: () => {},
      })
    );
    expect(container.querySelector('.queue-item-drag-handle')).toBeTruthy();
  });

  it('calls onDragStart with queueId when drag begins', async () => {
    const { render, fireEvent } = await import('@testing-library/react');
    const { default: QueueItem } = await import('#frontend/modules/Media/QueueItem.jsx');
    const onDragStart = vi.fn();
    const item = { queueId: 'a1', contentId: 'plex:1', title: 'Test' };
    const { container } = render(
      React.createElement(QueueItem, {
        item, isCurrent: false, onPlay: () => {}, onRemove: () => {},
        index: 0, onDragStart, onDrop: () => {},
      })
    );
    fireEvent.dragStart(container.querySelector('.queue-item'));
    expect(onDragStart).toHaveBeenCalledWith('a1');
  });

  it('calls onDrop with index when item is dropped onto', async () => {
    const { render, fireEvent } = await import('@testing-library/react');
    const { default: QueueItem } = await import('#frontend/modules/Media/QueueItem.jsx');
    const onDrop = vi.fn();
    const item = { queueId: 'b2', contentId: 'plex:2', title: 'Other' };
    const { container } = render(
      React.createElement(QueueItem, {
        item, isCurrent: false, onPlay: () => {}, onRemove: () => {},
        index: 2, onDragStart: () => {}, onDrop,
      })
    );
    fireEvent.drop(container.querySelector('.queue-item'));
    expect(onDrop).toHaveBeenCalledWith(2);
  });
});
