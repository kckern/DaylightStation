// frontend/src/modules/Media/shell/FleetIndicator.jsx
// Shared house playback summary; opens the canonical Fleet view. Nothing
// playing anywhere reads as nothing at all: the indicator hides at 0 (the
// Devices destination is always one tap away), otherwise "N playing" with a
// small dot, at the same height as the other header controls.
import React from 'react';
import { Button } from '@mantine/core';
import { useNav } from './NavProvider.jsx';
import { useFleetSummary } from '../fleet/useFleetSummary.js';

export function FleetIndicator() {
  const { view, push } = useNav();
  const { playing, paused } = useFleetSummary();
  const parts = [];
  if (playing > 0) parts.push(`${playing} playing`);
  if (paused > 0) parts.push(`${paused} paused`);
  if (parts.length === 0) return null;
  const summary = parts.join(', ');
  return (
    <Button
      variant="subtle"
      color="gray"
      size="sm"
      className="media-house-indicator"
      leftSection={<span className={`media-house-dot${playing > 0 ? ' media-house-dot--playing' : ''}`} aria-hidden="true" />}
      data-testid="house-indicator"
      aria-current={view === 'fleet' ? 'page' : undefined}
      onClick={() => push('fleet', {})}
    >
      {summary}
    </Button>
  );
}

export default FleetIndicator;
