import { Stack, Paper, Text, Group, Badge, Progress, Textarea } from '@mantine/core';

function stateColor(state) {
  const map = { committed: 'green', achieved: 'teal', failed: 'red', paused: 'yellow' };
  return map[state] || 'gray';
}

export function CycleRetro({ step, content, responses, setResponse }) {
  if (step === 0) {
    // Progress overview
    return (
      <Stack gap="md">
        <Text size="sm" fw={500}>Goal Progress This Cycle</Text>
        {(content?.goalProgress || []).map(g => (
          <Paper key={g.id} p="xs" withBorder>
            <Group justify="space-between" mb={4}>
              <Text size="sm">{g.name}</Text>
              <Badge size="xs" color={stateColor(g.state)}>{g.state}</Badge>
            </Group>
            <Progress value={(g.progress || 0) * 100} size="sm" />
          </Paper>
        ))}

        {content?.valueDrift?.length > 0 && (
          <>
            <Text size="sm" fw={500} mt="sm">Value Alignment</Text>
            <Group gap="xs">
              {content.valueDrift.map(v => (
                <Badge key={v.id} variant="light" color={v.alignment_state === 'aligned' ? 'green' : 'yellow'}>
                  {v.name}: {v.alignment_state}
                </Badge>
              ))}
            </Group>
          </>
        )}
      </Stack>
    );
  }

  if (step === 1) {
    // Reflection
    return (
      <Stack gap="md">
        <Text size="sm" fw={500}>What worked well this cycle?</Text>
        <Textarea
          value={responses.wins || ''}
          onChange={(e) => setResponse('wins', e.currentTarget.value)}
          autosize
          minRows={2}
        />

        <Text size="sm" fw={500}>What would you do differently?</Text>
        <Textarea
          value={responses.improvements || ''}
          onChange={(e) => setResponse('improvements', e.currentTarget.value)}
          autosize
          minRows={2}
        />

        <Text size="sm" fw={500}>Any beliefs to update?</Text>
        {(content?.beliefEvidence || []).map(b => (
          <Group key={b.id} gap="xs">
            <Badge size="xs">{b.state}</Badge>
            <Text size="xs">{b.id}: {Math.round((b.confidence || 0) * 100)}%</Text>
          </Group>
        ))}
      </Stack>
    );
  }

  // Next cycle planning
  return (
    <Stack gap="md">
      <Text size="sm" fw={500}>Focus for next cycle</Text>
      <Textarea
        placeholder="What's the priority for the next cycle?"
        value={responses.nextFocus || ''}
        onChange={(e) => setResponse('nextFocus', e.currentTarget.value)}
        autosize
        minRows={2}
      />

      {content?.ruleEffectiveness?.length > 0 && (
        <>
          <Text size="sm" fw={500}>Rule Effectiveness</Text>
          {content.ruleEffectiveness.map((r, i) => (
            <Group key={i} gap="xs">
              <Badge size="xs" color={r.effectiveness === 'effective' ? 'green' : 'yellow'}>
                {r.effectiveness || 'untested'}
              </Badge>
              <Text size="xs">{r.trigger} → {r.action}</Text>
            </Group>
          ))}
        </>
      )}
    </Stack>
  );
}
