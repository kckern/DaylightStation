import { RingProgress, Text, Stack, Badge } from '@mantine/core';

const STATUS_COLORS = {
  aligned: 'green',
  drifting: 'yellow',
  reconsidering: 'red',
};

export function DriftGauge({ correlation = 0, status = 'aligned' }) {
  const pct = Math.round(correlation * 100);
  const color = STATUS_COLORS[status] || 'gray';

  return (
    <Stack align="center" gap="xs">
      <RingProgress
        size={120}
        thickness={10}
        sections={[{ value: pct, color }]}
        label={
          <Text ta="center" size="lg" fw={700}>
            {pct}%
          </Text>
        }
      />
      <Badge color={color} variant="light" size="lg">
        {status}
      </Badge>
      <Text size="xs" c="dimmed">Value Alignment</Text>
    </Stack>
  );
}
