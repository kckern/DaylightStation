// frontend/src/modules/Health/CoachChat/chips/Chip.jsx
import { Badge } from '@mantine/core';
import {
  IconCalendar, IconCalendarEvent, IconRun, IconApple, IconScale, IconChartLine, IconAt,
} from '@tabler/icons-react';

const CHIP_REGISTRY = {
  period:          { icon: IconCalendar,      color: 'blue' },
  day:             { icon: IconCalendarEvent, color: 'gray' },
  workout:         { icon: IconRun,           color: 'orange' },
  nutrition:       { icon: IconApple,         color: 'green' },
  weight:          { icon: IconScale,         color: 'cyan' },
  metric_snapshot: { icon: IconChartLine,     color: 'violet' },
};

export function Chip({ label, chipKey }) {
  const cfg = CHIP_REGISTRY[chipKey] || { icon: IconAt, color: 'gray' };
  const Icon = cfg.icon;
  return (
    <Badge
      variant="light"
      color={cfg.color}
      leftSection={<Icon size={12} />}
      radius="sm"
      styles={{ root: { textTransform: 'none', fontWeight: 500 } }}
      data-chip-key={chipKey}
    >
      {label}
    </Badge>
  );
}

export default Chip;
