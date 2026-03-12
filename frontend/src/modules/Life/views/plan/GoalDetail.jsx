import { Stack, Paper, Title, Text, Group, Badge, Progress, Timeline, Button, Select } from '@mantine/core';
import { useState } from 'react';
import { IconTarget, IconFlag, IconHistory } from '@tabler/icons-react';
import { useGoalDetail, useGoals } from '../../hooks/useLifePlan.js';

function stateColor(state) {
  const map = {
    dream: 'grape', considered: 'blue', ready: 'cyan', committed: 'green',
    achieved: 'teal', failed: 'red', abandoned: 'dark', paused: 'yellow', evolved: 'violet',
  };
  return map[state] || 'gray';
}

const STATES = ['dream', 'considered', 'ready', 'committed', 'achieved', 'failed', 'abandoned', 'paused', 'evolved'];

export function GoalDetail({ goalId, username }) {
  const { goal, loading, error } = useGoalDetail(goalId, username);
  const { transitionGoal } = useGoals(username);
  const [transitionState, setTransitionState] = useState(null);

  if (loading) return null;
  if (error) return <Text c="red">{error}</Text>;
  if (!goal) return <Text c="dimmed">Goal not found</Text>;

  const handleTransition = async () => {
    if (!transitionState) return;
    await transitionGoal(goalId, transitionState, 'Manual transition');
    setTransitionState(null);
  };

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={4}>{goal.name}</Title>
        <Badge color={stateColor(goal.state)} size="lg">{goal.state}</Badge>
      </Group>

      {goal.why && (
        <Paper p="sm" withBorder>
          <Text size="sm" fw={500} mb={4}>Why</Text>
          <Text size="sm">{goal.why}</Text>
        </Paper>
      )}

      {goal.metrics?.length > 0 && (
        <Paper p="sm" withBorder>
          <Text size="sm" fw={500} mb="xs">Metrics</Text>
          <Stack gap="xs">
            {goal.metrics.map((m, i) => (
              <Stack key={i} gap={2}>
                <Group justify="space-between">
                  <Text size="xs">{m.name}</Text>
                  <Text size="xs" c="dimmed">{m.current}/{m.target} {m.unit}</Text>
                </Group>
                <Progress
                  value={m.target > 0 ? Math.min((m.current / m.target) * 100, 100) : 0}
                  color="blue"
                  size="xs"
                />
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}

      {goal.milestones?.length > 0 && (
        <Paper p="sm" withBorder>
          <Text size="sm" fw={500} mb="xs">Milestones</Text>
          <Timeline active={goal.milestones.filter(m => m.completed).length - 1} bulletSize={20}>
            {goal.milestones.map((m, i) => (
              <Timeline.Item
                key={i}
                bullet={<IconFlag size={12} />}
                title={m.name}
                color={m.completed ? 'green' : 'gray'}
              >
                <Text size="xs" c="dimmed">
                  {m.completed ? `Completed: ${m.completed_date || 'yes'}` : m.target_date || 'No date'}
                </Text>
              </Timeline.Item>
            ))}
          </Timeline>
        </Paper>
      )}

      {goal.dependencies?.length > 0 && (
        <Paper p="sm" withBorder>
          <Text size="sm" fw={500} mb="xs">Dependencies</Text>
          <Group gap="xs">
            {goal.dependencies.map((d, i) => (
              <Badge key={i} variant="light" size="sm">
                {d.type}: {d.target_id}
              </Badge>
            ))}
          </Group>
        </Paper>
      )}

      {goal.state_history?.length > 0 && (
        <Paper p="sm" withBorder>
          <Text size="sm" fw={500} mb="xs">State History</Text>
          <Timeline bulletSize={20}>
            {goal.state_history.slice(-5).reverse().map((h, i) => (
              <Timeline.Item
                key={i}
                bullet={<IconHistory size={12} />}
                title={`${h.from} → ${h.to}`}
              >
                <Text size="xs" c="dimmed">{h.reason} — {h.timestamp}</Text>
              </Timeline.Item>
            ))}
          </Timeline>
        </Paper>
      )}

      <Paper p="sm" withBorder>
        <Text size="sm" fw={500} mb="xs">Transition</Text>
        <Group>
          <Select
            placeholder="New state"
            data={STATES.filter(s => s !== goal.state).map(s => ({ value: s, label: s }))}
            value={transitionState}
            onChange={setTransitionState}
            size="xs"
          />
          <Button size="xs" disabled={!transitionState} onClick={handleTransition}>
            Transition
          </Button>
        </Group>
      </Paper>

      {goal.retrospective && (
        <Paper p="sm" withBorder>
          <Text size="sm" fw={500} mb={4}>Retrospective</Text>
          <Text size="sm">{goal.retrospective}</Text>
        </Paper>
      )}
    </Stack>
  );
}
