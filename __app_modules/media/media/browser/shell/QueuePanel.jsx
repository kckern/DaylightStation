// frontend/src/modules/Media/shell/QueuePanel.jsx
// THE queue component — written once against the controller interface and
// bound to the local session (Now Playing) or a remote session (Peek). Queue
// semantics are identical either way by design (J2 ≡ J5).
import React, { useContext, useEffect, useState } from 'react';
import { ActionIcon, Button, Group, Menu, Text, Badge, UnstyledButton } from '@mantine/core';
import { IconArrowsShuffle, IconRepeat, IconRepeatOnce, IconClearAll, IconChevronDown, IconChevronRight, IconDots } from '@tabler/icons-react';
import { ActionMenu } from '@/lib/ui/ActionMenu.jsx';
import { itemMenuEntries } from "../actions/itemMenuTable.js";
import { queueWindow, earlierLabel, UP_NEXT_SHOWN } from "./nowPlayingModel.js";
import { NavContext } from "./navContext.js";
import { useSessionController } from "../controller/useSessionController.js";
import { createOperationId } from "../actions/itemAction.js";
import { DispatchContext } from "../cast/DispatchProvider.jsx";
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { deviceName } from "../fleet/deviceDisplay.js";
import { EndOfQueueChoice } from "./EndOfQueueChoice.jsx";
import { getDeviceId } from "../../../../../frontend/src/lib/deviceIdentity.js";
import { PlayedEarlier } from "../household/PlayedEarlier.jsx";
import { TopMoreList } from '@/lib/ui/TopMore.jsx';
import mediaLog from "../logging/mediaLog.js";

// A long queue shows what plays now and the next few (nowPlayingModel.queueWindow):
// what already played collapses to one "Played N earlier in this queue" line
// that opens in place, and what comes later sits under More.
export const QUEUE_UP_NEXT_SHOWN = UP_NEXT_SHOWN;

/** The queue ids shown at first: the current item and the next few. */
export function queueWindowIds(items = [], currentIndex = 0) {
  return queueWindow(items, currentIndex).window.map((item) => item.queueItemId);
}

const REPEAT_NEXT = { off: 'all', all: 'one', one: 'off' };
const REPEAT_LABEL = { off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' };

// Remote queue/config ops resolve on the device-ack and can reject on ack
// timeout; the UI's truth comes from device-state, so swallow the rejection
// rather than leak an unhandled one. (Local ops return undefined — safe.)
const fire = (thunk) => { try { Promise.resolve(thunk()).catch(() => {}); } catch { /* sync throw */ } };

export function QueuePanel({ target = 'local', availability = null, showPlayedEarlier = true }) {
  const { controller, snapshot, queue, config } = useSessionController(target);
  const { push } = useContext(NavContext) ?? {};
  const [earlierOpen, setEarlierOpen] = useState(false);
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
  const playedEarlier = showPlayedEarlier ? (
    <PlayedEarlier key={remoteId ?? getDeviceId()} screenId={remoteId ?? getDeviceId()} currentContentId={snapshot?.currentItem?.contentId ?? null} />
  ) : null;
  // A different screen's queue starts collapsed again.
  useEffect(() => { setEarlierOpen(false); }, [remoteId]);

  // A live channel has no list to shuffle, repeat or clear (STEER.7a/AC4): when the only thing here is the live
  // item, the screen's queue says nothing; what it played earlier still follows.
  if (snapshot?.currentItem?.isLive === true && (q?.items?.length ?? 0) <= 1) {
    return playedEarlier;
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
        {playedEarlier}
      </>
    );
  }

  const indexOf = new Map(q.items.map((item, index) => [item.queueItemId, index]));
  const { earlier, window: windowed, later } = queueWindow(q.items, q.currentIndex);
  const toggleEarlier = () => {
    setEarlierOpen((open) => {
      if (!open) mediaLog.nowPlayingQueueExpanded({ part: 'earlier', count: earlier.length, target: remoteId ?? 'local' });
      return !open;
    });
  };
  const openDetail = (it) => {
    if (it.contentId) push?.('detail', { contentId: it.contentId });
  };
  const runRowVerb = (kind, it, idx) => {
    if (kind === 'playNow') dispatch(() => queue.jump?.(it.queueItemId));
    else if (kind === 'moveUp') dispatch(() => queue.reorder?.({ from: it.queueItemId, to: q.items[idx - 1].queueItemId }));
    else if (kind === 'moveDown') dispatch(() => queue.reorder?.({ from: it.queueItemId, to: q.items[idx + 1].queueItemId }));
    else if (kind === 'remove') edit('remove', it.queueItemId);
    else if (kind === 'details') openDetail(it);
  };
  const VERB_TESTID = { playNow: 'queue-jump', moveUp: 'queue-moveup', moveDown: 'queue-movedown', remove: 'queue-remove', details: 'queue-details' };
  const renderRow = (it) => {
    const idx = indexOf.get(it.queueItemId);
    const isCurrent = idx === q.currentIndex;
    const title = it.title ?? it.contentId;
    const rowLabel = `item ${idx + 1}, ${title}`;
    const cls = [
      'queue-item',
      isCurrent ? 'queue-item--current' : '',
      idx < q.currentIndex ? 'queue-item--earlier' : '',
      it.priority === 'upNext' ? 'queue-item--upnext' : '',
    ].filter(Boolean).join(' ');
    const entries = itemMenuEntries({
      surface: 'queue',
      household: false,
      queue: { current: isCurrent, first: idx === 0, last: idx === q.items.length - 1 },
    });
    return (
      <li
        key={it.queueItemId}
        data-testid={`queue-item-${it.queueItemId}`}
        className={cls}
        aria-current={isCurrent ? 'true' : undefined}
      >
        <span className="queue-item-index" aria-hidden="true">{idx + 1}</span>
        <UnstyledButton
          className="queue-item-title"
          data-testid={`queue-open-${it.queueItemId}`}
          aria-label={`Open ${title}${isCurrent ? ', playing now' : ''}`}
          onClick={() => openDetail(it)}
        >
          <span className="queue-item-text">{title}</span>
        </UnstyledButton>
        {isCurrent && <span className="queue-item-now" data-testid="queue-now">Now</span>}
        {it.priority === 'upNext' && (
          <Badge size="xs" color="amber" variant="light" className="queue-badge">up next</Badge>
        )}
        {it.addedBy === 'auto-continue' && (
          <Badge size="xs" color="gray" variant="light" className="queue-badge" data-testid={`queue-auto-${it.queueItemId}`}>
            added automatically
          </Badge>
        )}
        <ActionMenu
          position="bottom-end"
          withinPortal={false}
          shadow="md"
          dropdownProps={{ 'data-testid': `queue-menu-${it.queueItemId}-dropdown` }}
          trigger={
            <ActionIcon
              variant="subtle"
              color="gray"
              size={44}
              className="queue-item-more"
              data-testid={`queue-menu-${it.queueItemId}`}
              aria-label={`More for ${rowLabel}`}
            >
              <IconDots size={18} />
            </ActionIcon>
          }
        >
          {entries.map((entry, i) => (entry.divider
            ? <Menu.Divider key={`d${i}`} />
            : (
              <Menu.Item
                key={entry.kind}
                data-testid={`${VERB_TESTID[entry.kind]}-${it.queueItemId}`}
                aria-label={entry.kind === 'details' ? entry.label : `${entry.label}: ${rowLabel}`}
                disabled={entry.kind !== 'details' && !controlsAvailable}
                onClick={() => runRowVerb(entry.kind, it, idx)}
              >
                {entry.label}
              </Menu.Item>
            )))}
        </ActionMenu>
      </li>
    );
  };
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
          aria-label="Shuffle"
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
          aria-label={REPEAT_LABEL[repeat] ?? 'Repeat off'}
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
          aria-label="Clear the queue"
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
        {earlier.length > 0 && (
          <li className="queue-earlier-row">
            <UnstyledButton
              data-testid="queue-earlier"
              className="queue-earlier"
              aria-expanded={earlierOpen}
              onClick={toggleEarlier}
            >
              {earlierLabel(earlier.length)}
              {earlierOpen ? <IconChevronDown size={16} aria-hidden /> : <IconChevronRight size={16} aria-hidden />}
            </UnstyledButton>
          </li>
        )}
        {earlierOpen && earlier.map(renderRow)}
        {windowed.map(renderRow)}
        <TopMoreList
          items={later}
          n={0}
          getId={(it) => it.queueItemId}
          stable={false}
          expandedOrder="input"
          moreAs="li"
          testId="queue"
          onExpand={(counts) => {
            mediaLog.listMoreExpanded({ surface: 'queue', ...counts });
            mediaLog.nowPlayingQueueExpanded({ part: 'later', count: later.length, target: remoteId ?? 'local' });
          }}
          renderItem={renderRow}
        />
      </ul>
      <EndOfQueueChoice target={target} targetName={remoteId ? deviceName(remoteDevice, remoteId) : null} />
      {playedEarlier}
    </div>
  );
}

export default QueuePanel;
