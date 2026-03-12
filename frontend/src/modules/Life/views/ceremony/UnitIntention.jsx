import { Stack, Paper, Text, Group, Badge, Textarea, Checkbox } from '@mantine/core';

export function UnitIntention({ step, content, responses, setResponse }) {
  if (step === 0) {
    // Context: show active goals and applicable rules
    return (
      <Stack gap="md">
        <Text size="sm" fw={500}>Active Goals</Text>
        {(content?.activeGoals || []).map(g => (
          <Paper key={g.id} p="xs" withBorder>
            <Group justify="space-between">
              <Text size="sm">{g.name}</Text>
              <Badge size="xs" variant="light">{g.state}</Badge>
            </Group>
          </Paper>
        ))}

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
        <Text size="sm" fw={500}>What are your intentions for this unit?</Text>
        <Textarea
          placeholder="I will focus on..."
          value={responses.intentions || ''}
          onChange={(e) => setResponse('intentions', e.currentTarget.value)}
          autosize
          minRows={3}
        />

        <Text size="sm" fw={500} mt="sm">Energy level</Text>
        <Group gap="xs">
          {['low', 'medium', 'high'].map(level => (
            <Badge
              key={level}
              variant={responses.energy === level ? 'filled' : 'outline'}
              style={{ cursor: 'pointer' }}
              onClick={() => setResponse('energy', level)}
            >
              {level}
            </Badge>
          ))}
        </Group>
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
