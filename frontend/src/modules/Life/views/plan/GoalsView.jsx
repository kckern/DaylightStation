import { Stack, Paper, Title, Text, Group, Badge, SimpleGrid } from '@mantine/core';
import { useGoals } from '../../hooks/useLifePlan.js';
import { GoalProgressBar } from '../../widgets/GoalProgressBar.jsx';

const STATE_GROUPS = [
  { label: 'Dreams', states: ['dream'] },
  { label: 'Considered', states: ['considered'] },
  { label: 'Ready', states: ['ready'] },
  { label: 'Committed', states: ['committed'] },
  { label: 'Completed', states: ['achieved', 'failed', 'abandoned', 'paused', 'evolved'] },
];

function stateColor(state) {
  const map = {
    dream: 'grape', considered: 'blue', ready: 'cyan', committed: 'green',
    achieved: 'teal', failed: 'red', abandoned: 'dark', paused: 'yellow', evolved: 'violet',
  };
  return map[state] || 'gray';
}

function GoalCard({ goal, onClick }) {
  return (
    <Paper p="sm" withBorder style={{ cursor: 'pointer' }} onClick={() => onClick?.(goal.id)}>
      <Group justify="space-between" mb={4}>
        <Text size="sm" fw={500} lineClamp={1}>{goal.name}</Text>
        <Badge color={stateColor(goal.state)} variant="light" size="xs">
          {goal.state}
        </Badge>
      </Group>
      {goal.quality && (
        <Text size="xs" c="dimmed" mb={4}>{goal.quality}</Text>
      )}
      {goal.progress !== undefined && goal.progress > 0 && (
        <GoalProgressBar name="" state={goal.state} progress={goal.progress} />
      )}
      {goal.deadline && (
        <Text size="xs" c="dimmed" mt={4}>Due: {goal.deadline}</Text>
      )}
    </Paper>
  );
}

export function GoalsView({ username, onGoalClick }) {
  const { goals, loading } = useGoals(username);

  if (loading) return null;

  return (
    <Stack gap="md">
      <Title order={4}>Goals</Title>

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
        {STATE_GROUPS.map(group => {
          const groupGoals = goals.filter(g => group.states.includes(g.state));
          if (groupGoals.length === 0) return null;

          return (
            <Stack key={group.label} gap="sm">
              <Group>
                <Text size="sm" fw={600}>{group.label}</Text>
                <Badge size="xs" variant="light">{groupGoals.length}</Badge>
              </Group>
              {groupGoals.map(g => (
                <GoalCard key={g.id} goal={g} onClick={onGoalClick} />
              ))}
            </Stack>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}
