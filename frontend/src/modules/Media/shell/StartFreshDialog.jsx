// frontend/src/modules/Media/shell/StartFreshDialog.jsx
// RELY.8a / RQ-RELY-09 — Start fresh, itemised. Lists exactly what will be
// cleared on THIS device (what's playing, the queue, the spot, the aim),
// lets the person keep any part, and changes nothing until confirmed.
// Clearing everything starts a brand-new session. Other screens are never
// touched.
import React, { useEffect, useState } from 'react';
import { Checkbox, Stack, Text } from '@mantine/core';
import { ConfirmDialog } from './ConfirmDialog.jsx';
import { useSessionController } from '../controller/useSessionController.js';
import { useCastTarget } from '../cast/useCastTarget.js';
import { useFleetContext } from '../fleet/useFleetContext.js';
import { deviceName } from '../fleet/deviceDisplay.js';
import { formatTime } from './formatTime.js';

const ALL_CLEARED = Object.freeze({ playing: true, queue: true, spot: true, aim: true });

export function StartFreshDialog({ open, onClose }) {
  const { snapshot, lifecycle } = useSessionController('local');
  const { targetIds = [], clearTargets } = useCastTarget();
  const { devices } = useFleetContext();
  const [clear, setClear] = useState(ALL_CLEARED);
  useEffect(() => { if (open) setClear(ALL_CLEARED); }, [open]);

  const current = snapshot?.currentItem ?? null;
  const items = snapshot?.queue?.items ?? [];
  const others = current ? items.filter((entry) => entry.queueItemId !== items[snapshot.queue.currentIndex]?.queueItemId) : items;
  const title = current?.title ?? current?.contentId ?? null;
  const position = snapshot?.position ?? 0;
  const aimNames = targetIds.map((id) => deviceName(devices.find((device) => device.id === id), id)).join(', ');
  const spotLocked = clear.playing;
  const toggle = (part) => (event) => {
    const checked = event.currentTarget.checked;
    setClear((prev) => ({ ...prev, [part]: checked, ...(part === 'playing' && checked ? { spot: true } : {}) }));
  };
  const parts = [
    current && { part: 'playing', label: `What's playing: ${title}` },
    others.length > 0 && { part: 'queue', label: `Queue: ${others.length} ${current ? 'more ' : ''}item${others.length === 1 ? '' : 's'}` },
    current && position > 0 && { part: 'spot', label: `Spot: ${formatTime(position)} into ${title}` },
    targetIds.length > 0 && { part: 'aim', label: `Aim: ${aimNames} (return aim to this device)` },
  ].filter(Boolean);

  const confirm = () => {
    lifecycle.reset?.({ keep: { playing: !clear.playing, queue: !clear.queue, spot: !clear.playing && !clear.spot } });
    if (clear.aim && targetIds.length > 0) clearTargets?.();
    onClose?.();
  };

  return (
    <ConfirmDialog
      open={open}
      title="Start fresh on this device?"
      message={parts.length
        ? 'Ticked items will be cleared; untick anything you want to keep. It does not stop anything playing on other screens.'
        : 'There is nothing to clear on this device. It does not stop anything playing on other screens.'}
      confirmLabel="Start fresh"
      cancelLabel="Cancel"
      onConfirm={confirm}
      onCancel={() => onClose?.()}
    >
      <Stack gap="xs" mb="md" data-testid="start-fresh-items">
        {parts.map(({ part, label }) => (
          <Checkbox
            key={part}
            data-testid={`start-fresh-${part}`}
            label={label}
            checked={part === 'spot' && spotLocked ? true : clear[part]}
            disabled={part === 'spot' && spotLocked}
            onChange={toggle(part)}
          />
        ))}
        {parts.some(({ part }) => part === 'spot') && spotLocked && (
          <Text size="xs" c="dimmed">The spot is kept only with what&apos;s playing.</Text>
        )}
      </Stack>
    </ConfirmDialog>
  );
}

export default StartFreshDialog;
