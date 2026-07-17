import { Stack, Text, Group, Progress } from '@mantine/core';
import { humanize } from '../lib/format.js';

const COLORS = ['blue', 'green', 'orange', 'grape', 'cyan', 'pink', 'teal', 'red'];

// Sum of char codes — a stable, order-independent bucket for a value id so its
// bar color doesn't shuffle every time the allocation re-ranks.
function hashStr(str) {
  let sum = 0;
  for (let i = 0; i < String(str).length; i++) sum += String(str).charCodeAt(i);
  return sum;
}

export function ValueAllocationChart({ allocation }) {
  if (!allocation || Object.keys(allocation).length === 0) {
    return <Text size="sm" c="dimmed">No allocation data</Text>;
  }

  const sorted = Object.entries(allocation).sort((a, b) => b[1] - a[1]);

  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>Time Allocation</Text>
      {sorted.map(([valueId, proportion]) => (
        <Stack key={valueId} gap={2}>
          <Group justify="space-between">
            <Text size="xs">{humanize(valueId)}</Text>
            <Text size="xs" c="dimmed">{Math.round(proportion * 100)}%</Text>
          </Group>
          <Progress value={proportion * 100} color={COLORS[hashStr(valueId) % COLORS.length]} size="xs" />
        </Stack>
      ))}
    </Stack>
  );
}
