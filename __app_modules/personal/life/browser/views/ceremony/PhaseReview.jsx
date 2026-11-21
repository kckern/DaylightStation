import { Stack, Paper, Text, Textarea } from '@mantine/core';

export function PhaseReview({ step, content, responses, setResponse }) {
  if (step === 0) {
    return (
      <Stack gap="md">
        <Text size="sm" fw={500}>Phase Overview</Text>
        <Text size="sm" c="dimmed">
          Review the full state of your life plan at this phase boundary.
        </Text>
        <Paper p="sm" withBorder>
          <Text size="xs" c="dimmed">Period: {content?.periodId || 'N/A'}</Text>
        </Paper>
      </Stack>
    );
  }

  if (step === 1) {
    return (
      <Stack gap="md">
        <Text size="sm" fw={500}>Deep Review</Text>

        <Textarea
          label="Are your goals still aligned with your purpose?"
          value={responses.goalAlignment || ''}
          onChange={(e) => setResponse('goalAlignment', e.currentTarget.value)}
          autosize
          minRows={2}
        />

        <Textarea
          label="Are any beliefs ready to be confirmed or refuted?"
          value={responses.beliefUpdates || ''}
          onChange={(e) => setResponse('beliefUpdates', e.currentTarget.value)}
          autosize
          minRows={2}
        />
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Textarea
        label="Phase Adjustments"
        placeholder="What changes will you make for the next phase?"
        value={responses.adjustments || ''}
        onChange={(e) => setResponse('adjustments', e.currentTarget.value)}
        autosize
        minRows={3}
      />
    </Stack>
  );
}
