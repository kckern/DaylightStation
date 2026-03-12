import { Stack, Text, Group, Progress } from '@mantine/core';

const COLORS = ['blue', 'green', 'orange', 'grape', 'cyan', 'pink', 'teal', 'red'];

export function ValueAllocationChart({ allocation }) {
  if (!allocation || Object.keys(allocation).length === 0) {
    return <Text size="sm" c="dimmed">No allocation data</Text>;
  }

  const sorted = Object.entries(allocation).sort((a, b) => b[1] - a[1]);

  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>Time Allocation</Text>
      {sorted.map(([valueId, proportion], i) => (
        <Stack key={valueId} gap={2}>
          <Group justify="space-between">
            <Text size="xs">{valueId}</Text>
            <Text size="xs" c="dimmed">{Math.round(proportion * 100)}%</Text>
          </Group>
          <Progress value={proportion * 100} color={COLORS[i % COLORS.length]} size="xs" />
        </Stack>
      ))}
    </Stack>
  );
}
