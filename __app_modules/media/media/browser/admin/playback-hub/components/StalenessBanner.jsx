import React from 'react';
import { Alert } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

/**
 * StalenessBanner — visible only when the live status feed is stale.
 * Shows above the device cards so the operator knows the "BT ✓ / idle / 45/75"
 * info under each card may not reflect reality.
 *
 * Props:
 *   isStale:              boolean - from useStaleness
 *   secondsSinceUpdate:   number | null - from useStaleness
 */
export function StalenessBanner({ isStale, secondsSinceUpdate }) {
  if (!isStale) return null;
  const detail = secondsSinceUpdate == null
    ? 'no snapshot received yet'
    : `last update ${secondsSinceUpdate}s ago`;
  return (
    <Alert
      icon={<IconAlertTriangle size={16} />}
      color="yellow"
      title="Live updates paused"
    >
      Status cards below may not reflect reality — {detail}.
    </Alert>
  );
}

export default StalenessBanner;
