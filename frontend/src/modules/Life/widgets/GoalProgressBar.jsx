import { Progress, Text, Group, Stack } from '@mantine/core';
import { goalStateColor } from '../theme/semantics.js';

export function GoalProgressBar({ name, state, progress = 0 }) {
  const pct = Math.round(progress * 100);
  const color = goalStateColor(state);

  return (
    <Stack gap={4}>
      <Group justify="space-between">
        <Text size="sm" fw={500}>{name}</Text>
        <Text size="xs" c="dimmed">{pct}%</Text>
      </Group>
      <Progress value={pct} color={color} size="sm" />
    </Stack>
  );
}
