import { useState } from 'react';
import {
  Stack, Paper, Text, Group, Badge, SimpleGrid,
  Button, Modal, TextInput, Textarea, Alert,
} from '@mantine/core';
import { useGoals } from '../../hooks/useLifePlan.js';
import { GoalProgressBar } from '../../widgets/GoalProgressBar.jsx';
import { goalStateColor } from '../../theme/semantics.js';
import { LifePage, LoadingState } from '../../components/index.js';
import { formatDate } from '../../lib/format.js';

const STATE_GROUPS = [
  { label: 'Dreams', states: ['dream'] },
  { label: 'Considered', states: ['considered'] },
  { label: 'Ready', states: ['ready'] },
  { label: 'Committed', states: ['committed'] },
  { label: 'Completed', states: ['achieved', 'failed', 'abandoned', 'paused', 'evolved'] },
];

function GoalCard({ goal, onClick }) {
  return (
    <Paper p="sm" withBorder style={{ cursor: 'pointer' }} onClick={() => onClick?.(goal.id)}>
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
        <GoalProgressBar name="" state={goal.state} progress={goal.progress} />
      )}
      {goal.deadline && (
        <Text size="xs" c="dimmed" mt={4}>Due: {formatDate(goal.deadline)}</Text>
      )}
    </Paper>
  );
}

export function GoalsView({ username, onGoalClick }) {
  const { goals, loading, createGoal } = useGoals(username);

  const [opened, setOpened] = useState(false);
  const [name, setName] = useState('');
  const [why, setWhy] = useState('');
  const [milestone, setMilestone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const resetForm = () => {
    setName('');
    setWhy('');
    setMilestone('');
    setFormError(null);
  };

  const closeModal = () => {
    setOpened(false);
    resetForm();
  };

  const handleSubmit = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await createGoal({ name: name.trim(), why: why.trim() || undefined, milestone: milestone.trim() || undefined });
      closeModal();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const addModal = (
    <Modal opened={opened} onClose={closeModal} title="Add goal">
      <Stack gap="sm">
        {formError && (
          <Alert color="red" title="Couldn't create the goal">{formError}</Alert>
        )}
        <TextInput
          label="Goal"
          placeholder="What do you want to achieve?"
          required
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
        <Group justify="flex-end">
          <Button variant="subtle" onClick={closeModal}>Cancel</Button>
          <Button onClick={handleSubmit} loading={submitting} disabled={!name.trim()}>
            Create goal
          </Button>
        </Group>
      </Stack>
    </Modal>
  );

  if (loading) return <LoadingState />;

  const headerActions = <Button onClick={() => setOpened(true)}>Add goal</Button>;

  if (goals.length === 0) {
    return (
      <LifePage title="Goals">
        <Paper p="lg" withBorder radius="md">
          <Stack gap="sm" align="flex-start">
            <Text c="dimmed">
              No goals yet — add one below, or let your coach walk you through it.
            </Text>
            <Button onClick={() => setOpened(true)}>Add goal</Button>
          </Stack>
        </Paper>
        {addModal}
      </LifePage>
    );
  }

  return (
    <LifePage title="Goals" actions={headerActions}>
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

      {addModal}
    </LifePage>
  );
}
