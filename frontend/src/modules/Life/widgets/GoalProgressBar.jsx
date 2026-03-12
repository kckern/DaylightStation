import { Progress, Text, Group, Stack } from '@mantine/core';

const STATE_COLORS = {
  committed: 'blue',
  dream: 'gray',
  considered: 'cyan',
  ready: 'teal',
  paused: 'orange',
};

export function GoalProgressBar({ name, state, progress = 0 }) {
  const pct = Math.round(progress * 100);
  const color = STATE_COLORS[state] || 'blue';

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
