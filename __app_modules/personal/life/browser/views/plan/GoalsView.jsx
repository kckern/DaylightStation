import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Stack, Paper, Text, Group, Badge, SimpleGrid,
  Button, TextInput, Textarea,
} from '@mantine/core';
import { useGoals } from "../../hooks/useLifePlan.js";
import { GoalProgressBar } from "../../widgets/GoalProgressBar.jsx";
import { goalStateColor } from "../../theme/semantics.js";
import { LifePage, LoadingState, ErrorState } from "../../components/index.js";
import { useRetryRegion } from '@/lib/ui';
import { formatDate } from "../../lib/format.js";
import { PlanCreateSheet } from "./PlanCreateSheet.jsx";

const STATE_GROUPS = [
  { label: 'Dreams', states: ['dream'] },
  { label: 'Considered', states: ['considered'] },
  { label: 'Ready', states: ['ready'] },
  { label: 'Committed', states: ['committed'] },
  { label: 'Paused', states: ['paused'] },
  { label: 'Failed', states: ['failed'] },
  { label: 'Closed', states: ['achieved', 'abandoned', 'invalidated', 'evolved'] },
];

function GoalCard({ goal }) {
  return (
    <Paper component={Link} to={`/life/plan/goals/${goal.id}`} aria-label={goal.name} p="sm" withBorder className="life-goal-link ds-touch-target">
      <Group justify="space-between" mb={4}>
        <Text size="sm" fw={500} lineClamp={1}>{goal.name}</Text>
        <Badge color={goalStateColor(goal.state)} variant="light" size="xs">
          {goal.state}
        </Badge>
      </Group>
      {goal.quality && (
        <Text size="xs" c="dimmed" mb={4}>{goal.quality}</Text>
      )}
      {goal.progress !== undefined && goal.progress > 0 && (
        <GoalProgressBar name={goal.name} state={goal.state} progress={goal.progress} showName={false} />
      )}
      {goal.deadline && (
        <Text size="xs" c="dimmed" mt={4}>Due: {formatDate(goal.deadline)}</Text>
      )}
    </Paper>
  );
}

function GoalCreateSheet({ onClose, createGoal }) {
  const [name, setName] = useState('');
  const [why, setWhy] = useState('');
  const [milestone, setMilestone] = useState('');
  const save = () => createGoal({
    name: name.trim(),
    why: why.trim() || undefined,
    milestone: milestone.trim() || undefined,
  });

  return (
    <PlanCreateSheet noun="goal" onClose={onClose} save={save} valid={Boolean(name.trim())}>
      <TextInput
        label="Goal"
        placeholder="What do you want to achieve?"
        required
        data-autofocus
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
      />
      <Textarea
        label="Why does this matter?"
        placeholder="The purpose behind it"
        autosize
        minRows={2}
        value={why}
        onChange={(e) => setWhy(e.currentTarget.value)}
      />
      <TextInput
        label="First milestone"
        placeholder="A concrete first step"
        value={milestone}
        onChange={(e) => setMilestone(e.currentTarget.value)}
      />
    </PlanCreateSheet>
  );
}

export function GoalsView({ username }) {
  const { goals, loading, revalidating, error, refetch, createGoal } = useGoals(username);
  const { regionProps, retry } = useRetryRegion(refetch, loading || revalidating);
  const [opened, setOpened] = useState(false);
  const close = () => setOpened(false);
  const actions = (!loading || opened) && <Button onClick={() => setOpened(true)}>Add goal</Button>;
  let content;
  if (loading) content = <LoadingState />;
  else if (error) content = <ErrorState label="Goals" error={error} onRetry={retry} />;
  else if (goals.length === 0) {
    content = (
      <Paper p="lg" withBorder radius="md">
        <Text c="dimmed">No goals yet. Add a goal or let your coach walk you through it.</Text>
      </Paper>
    );
  } else content = (
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
              <GoalCard key={g.id} goal={g} />
            ))}
          </Stack>
        );
      })}
    </SimpleGrid>
  );

  return (
    <>
      <LifePage title="Goals" actions={actions} scrollReady={!loading && !error}>
        <section {...regionProps} aria-label="Goals results">
          {content}
        </section>
      </LifePage>
      {opened && <GoalCreateSheet createGoal={createGoal} onClose={close} />}
    </>
  );
}
