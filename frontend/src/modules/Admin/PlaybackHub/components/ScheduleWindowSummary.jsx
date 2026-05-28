import React from 'react';
import { Group, Text } from '@mantine/core';
import { useContentTitle } from '../hooks/useContentTitle.js';

const DASH = '—';

export function ScheduleWindowSummary({ window }) {
  const title = useContentTitle(window?.queue || '');
  const display = title || window?.queue || '(no queue)';
  const start = window?.start || DASH;
  const end = window?.end || DASH;

  return (
    <Group gap="xs" wrap="nowrap">
      <Text size="sm" ff="monospace">{`${start} – ${end}`}</Text>
      <Text size="sm" c="dimmed">·</Text>
      <Text size="sm" truncate>{display}</Text>
      {window?.shuffle && (
        <>
          <Text size="sm" c="dimmed">·</Text>
          <Text size="xs" c="blue.5">shuffle</Text>
        </>
      )}
    </Group>
  );
}

export default ScheduleWindowSummary;
