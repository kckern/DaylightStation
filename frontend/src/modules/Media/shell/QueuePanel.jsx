// frontend/src/modules/Media/shell/QueuePanel.jsx
// THE queue component — written once against the controller interface and
// bound to the local session (Now Playing) or a remote session (Peek). Queue
// semantics are identical either way by design (J2 ≡ J5).
import React from 'react';
import { ActionIcon, Button, Group, Text, Badge } from '@mantine/core';
import { IconX, IconArrowsShuffle, IconRepeat, IconRepeatOnce, IconClearAll } from '@tabler/icons-react';
import { useSessionController } from '../controller/useSessionController.js';

const REPEAT_NEXT = { off: 'all', all: 'one', one: 'off' };

export function QueuePanel({ target = 'local' }) {
  const { snapshot, queue, config } = useSessionController(target);
  const q = snapshot?.queue;

  if (!q || !Array.isArray(q.items) || q.items.length === 0) {
    return (
      <div data-testid="queue-empty" className="queue-empty">
        <Text c="dimmed" size="sm">Queue is empty — add something from search or browse.</Text>
      </div>
    );
  }

  const shuffle = !!snapshot.config?.shuffle;
  const repeat = snapshot.config?.repeat ?? 'off';

  return (
    <div data-testid="queue-panel" className="queue-panel">
      <Group className="queue-toolbar" gap="xs">
        <Text size="sm" c="dimmed" className="queue-count">
          {q.items.length} item{q.items.length === 1 ? '' : 's'}
        </Text>
        <Button
          data-testid="queue-shuffle"
          size="compact-sm"
          variant={shuffle ? 'light' : 'subtle'}
          color={shuffle ? 'amber' : 'gray'}
          aria-pressed={shuffle}
          leftSection={<IconArrowsShuffle size={16} />}
          onClick={() => config.setShuffle?.(!shuffle)}
        >
          Shuffle
        </Button>
        <Button
          data-testid="queue-repeat"
          size="compact-sm"
          variant={repeat !== 'off' ? 'light' : 'subtle'}
          color={repeat !== 'off' ? 'amber' : 'gray'}
          leftSection={repeat === 'one' ? <IconRepeatOnce size={16} /> : <IconRepeat size={16} />}
          onClick={() => config.setRepeat?.(REPEAT_NEXT[repeat])}
        >
          Repeat: {repeat}
        </Button>
        <Button
          data-testid="queue-clear"
          size="compact-sm"
          variant="subtle"
          color="gray"
          leftSection={<IconClearAll size={16} />}
          onClick={() => queue.clear?.()}
          ml="auto"
        >
          Clear
        </Button>
      </Group>
      <ul className="queue-items">
        {q.items.map((it, idx) => {
          const isCurrent = idx === q.currentIndex;
          const cls = [
            'queue-item',
            isCurrent ? 'queue-item--current' : '',
            it.priority === 'upNext' ? 'queue-item--upnext' : '',
          ].filter(Boolean).join(' ');
          return (
            <li key={it.queueItemId} data-testid={`queue-item-${it.queueItemId}`} className={cls}>
              <button
                className="queue-item-title"
                data-testid={`queue-jump-${it.queueItemId}`}
                onClick={() => queue.jump?.(it.queueItemId)}
                disabled={isCurrent}
              >
                <span className="queue-item-index">{idx + 1}.</span>
                {it.title ?? it.contentId}
              </button>
              {it.priority === 'upNext' && (
                <Badge size="xs" color="amber" variant="light" className="queue-badge">up next</Badge>
              )}
              <ActionIcon
                size="md"
                aria-label="Remove from queue"
                data-testid={`queue-remove-${it.queueItemId}`}
                onClick={() => queue.remove?.(it.queueItemId)}
              >
                <IconX size={16} />
              </ActionIcon>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default QueuePanel;
