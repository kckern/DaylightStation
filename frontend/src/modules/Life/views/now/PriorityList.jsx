import { Stack, Paper, Group, Text, Badge, ThemeIcon } from '@mantine/core';
import { IconTarget, IconAlertTriangle, IconTrendingDown, IconBrain } from '@tabler/icons-react';

const TYPE_CONFIG = {
  goal_deadline: { icon: IconTarget, color: 'blue', label: 'Goal' },
  drift_alert: { icon: IconTrendingDown, color: 'yellow', label: 'Drift' },
  anti_goal_warning: { icon: IconAlertTriangle, color: 'red', label: 'Warning' },
  dormant_belief: { icon: IconBrain, color: 'grape', label: 'Belief' },
};

export function PriorityList({ priorities = [] }) {
  if (priorities.length === 0) {
    return <Text size="sm" c="dimmed">No priorities right now.</Text>;
  }

  return (
    <Stack gap="sm">
      {priorities.slice(0, 5).map((item, i) => {
        const config = TYPE_CONFIG[item.type] || TYPE_CONFIG.goal_deadline;
        const Icon = config.icon;

        return (
          <Paper key={i} p="sm" withBorder>
            <Group>
              <ThemeIcon color={config.color} variant="light" size="lg">
                <Icon size={18} />
              </ThemeIcon>
              <Stack gap={2} style={{ flex: 1 }}>
                <Text size="sm" fw={500}>{item.title}</Text>
                <Text size="xs" c="dimmed">{item.reason}</Text>
              </Stack>
              <Badge color={config.color} variant="light" size="sm">
                {config.label}
              </Badge>
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );
}
