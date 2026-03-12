import { Stack, Text, Textarea, Group, Badge } from '@mantine/core';

export function UnitCapture({ step, content, responses, setResponse }) {
  if (step === 0) {
    return (
      <Stack gap="md">
        <Text size="sm" fw={500}>Review: How did this unit go?</Text>
        <Text size="xs" c="dimmed">
          Think about your active goals and whether you followed your rules.
        </Text>
        {(content?.activeGoals || []).map(g => (
          <Group key={g.id} gap="xs">
            <Badge size="xs" variant="light">{g.state}</Badge>
            <Text size="sm">{g.name}</Text>
          </Group>
        ))}
      </Stack>
    );
  }

  if (step === 1) {
    return (
      <Stack gap="md">
        <Text size="sm" fw={500}>Observations</Text>
        <Textarea
          placeholder="What went well? What was difficult?"
          value={responses.observations || ''}
          onChange={(e) => setResponse('observations', e.currentTarget.value)}
          autosize
          minRows={3}
        />

        <Text size="sm" fw={500}>Mood</Text>
        <Group gap="xs">
          {['frustrated', 'neutral', 'satisfied', 'energized'].map(mood => (
            <Badge
              key={mood}
              variant={responses.mood === mood ? 'filled' : 'outline'}
              style={{ cursor: 'pointer' }}
              onClick={() => setResponse('mood', mood)}
            >
              {mood}
            </Badge>
          ))}
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Text size="sm" fw={500}>Confirm your capture</Text>
      <Text size="sm">{responses.observations || 'No observations'}</Text>
      {responses.mood && <Text size="sm" c="dimmed">Mood: {responses.mood}</Text>}
    </Stack>
  );
}
