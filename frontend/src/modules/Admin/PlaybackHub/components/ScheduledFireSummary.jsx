import React from 'react';
import { Group, Text, Badge } from '@mantine/core';
import { useContentTitle } from '../hooks/useContentTitle.js';

export function ScheduledFireSummary({ row }) {
  const title = useContentTitle(row?.queue || '');
  const display = title || row?.queue || '(no queue)';
  return (
    <Group gap="xs" wrap="nowrap">
      <Text size="sm" ff="monospace">{row?.time || '—'}</Text>
      <Text size="sm" c="dimmed">·</Text>
      <Badge size="xs" variant="light">{row?.days || 'all'}</Badge>
      <Text size="sm" c="dimmed">·</Text>
      <Text size="sm" truncate>{display}</Text>
    </Group>
  );
}

export default ScheduledFireSummary;
