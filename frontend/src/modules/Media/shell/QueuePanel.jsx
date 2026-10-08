// frontend/src/modules/Media/shell/QueuePanel.jsx
// THE queue component — written once against the controller interface and
// bound to the local session (Now Playing) or a remote session (Peek). Queue
// semantics are identical either way by design (J2 ≡ J5).
import React, { useContext } from 'react';
import { ActionIcon, Button, Group, Text, Badge } from '@mantine/core';
import { IconX, IconArrowsShuffle, IconRepeat, IconRepeatOnce, IconClearAll, IconChevronUp, IconChevronDown } from '@tabler/icons-react';
import { useSessionController } from '../controller/useSessionController.js';
import { createOperationId } from '../actions/itemAction.js';
import { DispatchContext } from '../cast/DispatchProvider.jsx';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { deviceName } from '../fleet/deviceDisplay.js';
import { EndOfQueueChoice } from './EndOfQueueChoice.jsx';
import { getDeviceId } from '../../../lib/deviceIdentity.js';
import { PlayedEarlier } from '../household/PlayedEarlier.jsx';

const REPEAT_NEXT = { off: 'all', all: 'one', one: 'off' };
const REPEAT_LABEL = { off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' };

// Remote queue/config ops resolve on the device-ack and can reject on ack
// timeout; the UI's truth comes from device-state, so swallow the rejection
// rather than leak an unhandled one. (Local ops return undefined — safe.)
const fire = (thunk) => { try { Promise.resolve(thunk()).catch(() => {}); } catch { /* sync throw */ } };

export function QueuePanel({ target = 'local', availability = null }) {
  const { controller, snapshot, queue, config } = useSessionController(target);
  const outcomes = useContext(DispatchContext);
  const remoteId = target === 'local' ? null : target?.deviceId ?? null;
  const fleet = useContext(FleetContext);
  const remoteDevice = remoteId ? fleet?.devices?.find((device) => device.id === remoteId) ?? null : null;
  const q = snapshot?.queue;
  const controlsAvailable = availability?.available !== false;
  const dispatch = (thunk) => {
    if (controlsAvailable) fire(thunk);
  };
  const edit = (kind, queueItemId) => {
    if (!controlsAvailable) return;
    if (!controller?.execute) { dispatch(() => kind === 'clear' ? queue.clear?.() : queue.remove?.(queueItemId)); return; }
    const operationId = createOperationId();
    const entry = q?.items?.find((item) => item.queueItemId === queueItemId);
    // The edit reports through the one outcome system, with its Undo on the
    // outcome itself (RELY.1a, RELY.4a).
    const attemptId = outcomes?.recordLocal?.({
      kind,
      phase: 'running',
      item: kind === 'clear' ? { title: 'the queue' } : { contentId: entry?.contentId ?? null, title: entry?.title ?? 'the item' },
      command: { kind, queueItemId },
      undo: { operationId, expiresAt: Date.now() + 10000, run: controller.undo },
      targetId: remoteId ?? 'local',
      targetName: remoteId ? deviceName(remoteDevice, remoteId) : null,
    }) ?? null;
    let pending;
    try { pending = controller.execute({ kind, queueItemId, operationId, tappedAt: Date.now() }); }
    catch (error) { pending = { ok: false, reason: error?.message }; }
    Promise.resolve(pending).then(
      (result) => outcomes?.resolveLocal?.(attemptId, result?.ok === false
        ? { phase: 'failed', reason: result.reason ?? result.code ?? 'Could not change the queue' }
        : { phase: 'confirmed' }),
      (error) => outcomes?.resolveLocal?.(attemptId, { phase: 'failed', reason: error?.message ?? 'Could not change the queue' }),
    );
  };

  // FIND.11a: every screen's queue — this device's or a remote one's — ends
  // with what played there earlier, whether or not anything is queued.
  const earlier = (
    <PlayedEarlier screenId={remoteId ?? getDeviceId()} currentContentId={snapshot?.currentItem?.contentId ?? null} />
  );

  // A live channel has no list to shuffle, repeat or clear (STEER.7a/AC4): when the only thing here is the live
  // item, the screen's queue says nothing; what it played earlier still follows.
  if (snapshot?.currentItem?.isLive === true && (q?.items?.length ?? 0) <= 1) {
    return earlier;
  }

  if (!q || !Array.isArray(q.items) || q.items.length === 0) {
    // A single dispatched item plays with an empty queue array (the device
    // has no up-next list) — "Queue is empty, add something" then reads as a
    // contradiction under a playing title. Say what's actually true.
    const playingSolo = !!snapshot?.currentItem
      && ['playing', 'paused', 'buffering', 'stalled'].includes(snapshot?.state);
    return (
      <>
        <div data-testid="queue-empty" className="queue-empty">
          <Text c="dimmed" size="sm">
            {playingSolo
              ? 'Nothing queued up next.'
              : 'Queue is empty — add something from search or browse.'}
          </Text>
          {/* A single playing item still ends: its end-of-queue choice applies. */}
          {playingSolo && <EndOfQueueChoice target={target} targetName={remoteId ? deviceName(remoteDevice, remoteId) : null} />}
        </div>
        {earlier}
      </>
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
          disabled={!controlsAvailable}
          onClick={() => dispatch(() => config.setShuffle?.(!shuffle))}
        >
          Shuffle
        </Button>
        <Button
          data-testid="queue-repeat"
          size="compact-sm"
          variant={repeat !== 'off' ? 'light' : 'subtle'}
          color={repeat !== 'off' ? 'amber' : 'gray'}
          leftSection={repeat === 'one' ? <IconRepeatOnce size={16} /> : <IconRepeat size={16} />}
          disabled={!controlsAvailable}
          onClick={() => dispatch(() => config.setRepeat?.(REPEAT_NEXT[repeat]))}
        >
          {REPEAT_LABEL[repeat] ?? 'Repeat off'}
        </Button>
        <Button
          data-testid="queue-clear"
          size="compact-sm"
          variant="subtle"
          color="gray"
          leftSection={<IconClearAll size={16} />}
          disabled={!controlsAvailable}
          onClick={() => edit('clear')}
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
                onClick={() => dispatch(() => queue.jump?.(it.queueItemId))}
                disabled={!controlsAvailable || isCurrent}
              >
                <span className="queue-item-index">{idx + 1}.</span>
                {it.title ?? it.contentId}
              </button>
              {it.priority === 'upNext' && (
                <Badge size="xs" color="amber" variant="light" className="queue-badge">up next</Badge>
              )}
              {it.addedBy === 'auto-continue' && (
                <Badge size="xs" color="gray" variant="light" className="queue-badge" data-testid={`queue-auto-${it.queueItemId}`}>
                  added automatically
                </Badge>
              )}
              {/* Reorder: discrete tap targets, not drag (touch-first) */}
              <ActionIcon
                size="md"
                aria-label="Move up"
                data-testid={`queue-moveup-${it.queueItemId}`}
                disabled={!controlsAvailable || idx === 0}
                onClick={() => dispatch(() => queue.reorder?.({ from: it.queueItemId, to: q.items[idx - 1].queueItemId }))}
              >
                <IconChevronUp size={16} />
              </ActionIcon>
              <ActionIcon
                size="md"
                aria-label="Move down"
                data-testid={`queue-movedown-${it.queueItemId}`}
                disabled={!controlsAvailable || idx === q.items.length - 1}
                onClick={() => dispatch(() => queue.reorder?.({ from: it.queueItemId, to: q.items[idx + 1].queueItemId }))}
              >
                <IconChevronDown size={16} />
              </ActionIcon>
              <ActionIcon
                size="md"
                aria-label="Remove from queue"
                data-testid={`queue-remove-${it.queueItemId}`}
                disabled={!controlsAvailable}
                onClick={() => edit('remove', it.queueItemId)}
              >
                <IconX size={16} />
              </ActionIcon>
            </li>
          );
        })}
      </ul>
      <EndOfQueueChoice target={target} targetName={remoteId ? deviceName(remoteDevice, remoteId) : null} />
      {earlier}
    </div>
  );
}

export default QueuePanel;
