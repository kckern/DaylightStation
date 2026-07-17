import { Group, Badge } from '@mantine/core';
import { formatPeriodLabel } from '../lib/format.js';

export function CadenceIndicator({ cadencePosition }) {
  if (!cadencePosition) return null;

  return (
    <Group gap="xs">
      {['unit', 'cycle', 'phase', 'season', 'era'].map(level => {
        const pos = cadencePosition[level];
        if (!pos) return null;
        return (
          <Badge key={level} variant="light" size="sm" color="violet">
            {formatPeriodLabel({ ...pos, level })}
          </Badge>
        );
      })}
    </Group>
  );
}
