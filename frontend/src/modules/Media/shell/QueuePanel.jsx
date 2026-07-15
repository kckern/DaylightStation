// frontend/src/modules/Media/shell/QueuePanel.jsx
// THE queue component — written once against the controller interface and
// bound to the local session (Now Playing) or a remote session (Peek). Queue
// semantics are identical either way by design (J2 ≡ J5).
import React from 'react';
import { ActionIcon, Button, Group, Text, Badge } from '@mantine/core';
import { IconX, IconArrowsShuffle, IconRepeat, IconRepeatOnce, IconClearAll, IconChevronUp, IconChevronDown } from '@tabler/icons-react';
import { useSessionController } from '../controller/useSessionController.js';

const REPEAT_NEXT = { off: 'all', all: 'one', one: 'off' };
const REPEAT_LABEL = { off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' };

// Remote queue/config ops resolve on the device-ack and can reject on ack
// timeout; the UI's truth comes from device-state, so swallow the rejection
// rather than leak an unhandled one. (Local ops return undefined — safe.)
const fire = (thunk) => { try { Promise.resolve(thunk()).catch(() => {}); } catch { /* sync throw */ } };

export function QueuePanel({ target = 'local' }) {
  const { snapshot, queue, config } = useSessionController(target);
  const q = snapshot?.queue;

  if (!q || !Array.isArray(q.items) || q.items.length === 0) {
    // A single dispatched item plays with an empty queue array (the device
    // has no up-next list) — "Queue is empty, add something" then reads as a
    // contradiction under a playing title. Say what's actually true.
    const playingSolo = !!snapshot?.currentItem
      && ['playing', 'paused', 'buffering', 'stalled'].includes(snapshot?.state);
    return (
      <div data-testid="queue-empty" className="queue-empty">
        <Text c="dimmed" size="sm">
          {playingSolo
            ? 'Nothing queued up next.'
            : 'Queue is empty — add something from search or browse.'}
        </Text>
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
          onClick={() => fire(() => config.setShuffle?.(!shuffle))}
        >
          Shuffle
        </Button>
        <Button
          data-testid="queue-repeat"
          size="compact-sm"
          variant={repeat !== 'off' ? 'light' : 'subtle'}
          color={repeat !== 'off' ? 'amber' : 'gray'}
          leftSection={repeat === 'one' ? <IconRepeatOnce size={16} /> : <IconRepeat size={16} />}
          onClick={() => fire(() => config.setRepeat?.(REPEAT_NEXT[repeat]))}
        >
          {REPEAT_LABEL[repeat] ?? 'Repeat off'}
        </Button>
        <Button
          data-testid="queue-clear"
          size="compact-sm"
          variant="subtle"
          color="gray"
          leftSection={<IconClearAll size={16} />}
          onClick={() => fire(() => queue.clear?.())}
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
                onClick={() => fire(() => queue.jump?.(it.queueItemId))}
                disabled={isCurrent}
              >
                <span className="queue-item-index">{idx + 1}.</span>
                {it.title ?? it.contentId}
              </button>
              {it.priority === 'upNext' && (
                <Badge size="xs" color="amber" variant="light" className="queue-badge">up next</Badge>
              )}
              {/* Reorder: discrete tap targets, not drag (touch-first) */}
              <ActionIcon
                size="md"
                aria-label="Move up"
                data-testid={`queue-moveup-${it.queueItemId}`}
                disabled={idx === 0}
                onClick={() => fire(() => queue.reorder?.({ from: it.queueItemId, to: q.items[idx - 1].queueItemId }))}
              >
                <IconChevronUp size={16} />
              </ActionIcon>
              <ActionIcon
                size="md"
                aria-label="Move down"
                data-testid={`queue-movedown-${it.queueItemId}`}
                disabled={idx === q.items.length - 1}
                onClick={() => fire(() => queue.reorder?.({ from: it.queueItemId, to: q.items[idx + 1].queueItemId }))}
              >
                <IconChevronDown size={16} />
              </ActionIcon>
              <ActionIcon
                size="md"
                aria-label="Remove from queue"
                data-testid={`queue-remove-${it.queueItemId}`}
                onClick={() => fire(() => queue.remove?.(it.queueItemId))}
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
