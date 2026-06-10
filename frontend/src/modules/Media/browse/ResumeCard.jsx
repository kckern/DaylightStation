// frontend/src/modules/Media/browse/ResumeCard.jsx
// Home's continue-where-you-left-off card, bound to the live local session.
import React from 'react';
import { Button, Text } from '@mantine/core';
import { IconPlayerPlayFilled } from '@tabler/icons-react';
import { useSessionController } from '../controller/useSessionController.js';
import { usePlaybackPosition } from '../controller/usePlaybackPosition.js';

function fmt(seconds) {
  const m = Math.floor((seconds ?? 0) / 60);
  const s = Math.floor((seconds ?? 0) % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ResumeCard() {
  const { controller, snapshot, transport } = useSessionController('local');
  const live = usePlaybackPosition(controller);
  const item = snapshot?.currentItem;
  if (!item || snapshot.state === 'idle') return null;

  const position = live.seconds || snapshot.position || 0;

  return (
    <div data-testid="resume-card" className="resume-card">
      {item.thumbnail && <img className="resume-card-thumb" src={item.thumbnail} alt="" />}
      <div className="resume-card-body">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Resume</Text>
        <Text fw={600} className="resume-card-title">{item.title ?? item.contentId}</Text>
        <Text size="sm" c="dimmed">at {fmt(position)}</Text>
      </div>
      <Button
        data-testid="resume-play"
        leftSection={<IconPlayerPlayFilled size={16} />}
        onClick={() => transport.play?.()}
      >
        Resume
      </Button>
    </div>
  );
}

export default ResumeCard;
