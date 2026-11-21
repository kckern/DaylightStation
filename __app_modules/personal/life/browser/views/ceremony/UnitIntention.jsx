import { useId } from 'react';
import { Stack, Paper, Text, Group, Badge, Textarea, Chip } from '@mantine/core';

export function UnitIntention({ step, content, responses, setResponse }) {
  const energyLabelId = useId();
  if (step === 0) {
    // Context: show active goals and applicable rules
    return (
      <Stack gap="md">
        <Text size="sm" fw={500}>Active Goals</Text>
        {content?.activeGoals?.length
          ? content.activeGoals.map(g => (
            <Paper key={g.id} p="xs" withBorder>
              <Group justify="space-between">
                <Text size="sm">{g.name}</Text>
                <Badge size="xs" variant="light">{g.state}</Badge>
              </Group>
            </Paper>
          ))
          : <Text size="xs" c="dimmed">No active goals for this unit.</Text>}

        {content?.rules?.length > 0 && (
          <>
            <Text size="sm" fw={500} mt="sm">Applicable Rules</Text>
            {content.rules.map((r, i) => (
              <Text key={i} size="xs" c="dimmed">
                When {r.trigger} → {r.action}
              </Text>
            ))}
          </>
        )}
      </Stack>
    );
  }

  if (step === 1) {
    // Intentions: capture what to focus on
    return (
      <Stack gap="md">
        <Textarea
          label="What are your intentions for this unit?"
          placeholder="I will focus on..."
          value={responses.intentions || ''}
          onChange={(e) => setResponse('intentions', e.currentTarget.value)}
          autosize
          minRows={3}
        />

        <Text id={energyLabelId} size="sm" fw={500} mt="sm">Energy level</Text>
        <Chip.Group multiple={false} value={responses.energy ?? null} onChange={value => setResponse('energy', value)}>
          <Group gap="xs" role="radiogroup" aria-labelledby={energyLabelId}>
            {['low', 'medium', 'high'].map(level => (
              <Chip key={level} value={level} size="sm" variant="outline">{level}</Chip>
            ))}
          </Group>
        </Chip.Group>
      </Stack>
    );
  }

  // Step 2: Confirm
  return (
    <Stack gap="md">
      <Text size="sm" fw={500}>Review your intentions</Text>
      <Paper p="sm" withBorder bg="blue.0">
        <Text size="sm">{responses.intentions || 'No intentions set'}</Text>
      </Paper>
      {responses.energy && (
        <Text size="sm" c="dimmed">Energy: {responses.energy}</Text>
      )}
    </Stack>
  );
}
