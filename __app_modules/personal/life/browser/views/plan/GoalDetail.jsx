import { Stack, Paper, Text, Group, Badge, Progress, Timeline, Button, Select, Alert } from '@mantine/core';
import { useState } from 'react';
import { IconFlag, IconHistory } from '@tabler/icons-react';
import { useGoalDetail } from "../../hooks/useLifePlan.js";
import { goalStateColor } from "../../theme/semantics.js";
import { LifePage, LoadingState, ErrorState } from "../../components/index.js";
import { formatDate, humanize } from "../../lib/format.js";

function formatHistoryDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return formatDate(value);
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function GoalDetail({ goalId, username }) {
  const { goal, loading, error, refetch, transitionGoal } = useGoalDetail(goalId, username);
  const [transitionState, setTransitionState] = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  if (loading && !goal) return <LoadingState />;
  if (error) return <ErrorState label="Goal" error={error} onRetry={refetch} />;
  if (!goal) return <Text c="dimmed">Goal not found</Text>;

  const transitions = goal.validTransitions || [];
  const selectedTransition = transitions.includes(transitionState) ? transitionState : null;
  const canTransition = Boolean(selectedTransition) && !submitting;
  const handleTransition = async () => {
    if (!canTransition) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await transitionGoal(goalId, selectedTransition, 'Manual transition');
      setTransitionState(null);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <LifePage title={goal.name} actions={<Badge color={goalStateColor(goal.state)} size="lg">{goal.state}</Badge>}>
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
                  aria-label={m.name}
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
          <Timeline bulletSize={20}>
            {goal.milestones.map((m, i) => (
              <Timeline.Item
                key={i}
                active={Boolean(m.completed)}
                bullet={<IconFlag size={12} />}
                title={m.name}
                color={m.completed ? 'green' : 'gray'}
              >
                <Text size="xs" c="dimmed">
                  {m.completed ? `Completed: ${formatDate(m.completed_date) || 'yes'}` : formatDate(m.target_date) || 'No date'}
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
                {humanize(d.type)}: {humanize(d.target_id)}
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
                <Text size="xs" c="dimmed">{h.reason} — {formatHistoryDate(h.timestamp)}</Text>
              </Timeline.Item>
            ))}
          </Timeline>
        </Paper>
      )}

      {transitions.length > 0 && (
        <Paper p="sm" withBorder>
          <Group>
            <Select
              label="New state"
              disabled={submitting}
              data={transitions.map(s => ({ value: s, label: s }))}
              value={selectedTransition}
              onChange={setTransitionState}
              size="xs"
            />
            <Button size="xs" disabled={!canTransition} onClick={handleTransition}>
              Transition
            </Button>
          </Group>
          {submitError && <Alert color="red" title="Transition failed">{submitError}</Alert>}
        </Paper>
      )}

      {goal.retrospective && (
        <Paper p="sm" withBorder>
          <Text size="sm" fw={500} mb={4}>Retrospective</Text>
          <Text size="sm">{goal.retrospective}</Text>
        </Paper>
      )}
    </LifePage>
  );
}
