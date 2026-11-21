import { useId } from 'react';
import { Stack, Text, Textarea, Group, Badge, Paper, Chip } from '@mantine/core';

export function UnitCapture({ step, content, responses, setResponse }) {
  const moodLabelId = useId();
  if (step === 0) {
    // Completion records may nest the POST body ({responses: {...}}) inside the
    // record's own responses field — normalize both shapes defensively.
    const morning = content?.morningIntention?.responses?.responses
      || content?.morningIntention?.responses
      || {};

    return (
      <Stack gap="md">
        {content?.morningIntention && (
          <Paper p="sm" radius="md" withBorder>
            <Group gap="xs" justify="space-between" mb={4}>
              <Text size="xs" fw={600} c="dimmed">This morning you said</Text>
              {morning.energy && <Badge size="xs" variant="light">{morning.energy}</Badge>}
            </Group>
            <Text size="sm">{morning.intentions || 'No intentions recorded'}</Text>
          </Paper>
        )}
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
        <Textarea
          label="Observations"
          placeholder="What went well? What was difficult?"
          value={responses.observations || ''}
          onChange={(e) => setResponse('observations', e.currentTarget.value)}
          autosize
          minRows={3}
        />

        <Text id={moodLabelId} size="sm" fw={500}>Mood</Text>
        <Chip.Group multiple={false} value={responses.mood ?? null} onChange={value => setResponse('mood', value)}>
          <Group gap="xs" role="radiogroup" aria-labelledby={moodLabelId}>
            {['frustrated', 'neutral', 'satisfied', 'energized'].map(mood => (
              <Chip key={mood} value={mood} size="sm" variant="outline">{mood}</Chip>
            ))}
          </Group>
        </Chip.Group>
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
