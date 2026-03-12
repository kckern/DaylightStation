import { Group, Badge, Text } from '@mantine/core';

export function CadenceIndicator({ cadencePosition }) {
  if (!cadencePosition) return null;

  return (
    <Group gap="xs">
      {['unit', 'cycle', 'phase', 'season', 'era'].map(level => {
        const pos = cadencePosition[level];
        if (!pos) return null;
        return (
          <Badge key={level} variant="outline" size="sm" color="blue">
            <Text span size="xs">{pos.alias || level}: {pos.periodId}</Text>
          </Badge>
        );
      })}
    </Group>
  );
}
