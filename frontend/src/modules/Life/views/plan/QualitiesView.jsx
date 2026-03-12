import { Stack, Paper, Title, Text, Group, Badge, Accordion, ThemeIcon } from '@mantine/core';
import { IconShield, IconAlertTriangle } from '@tabler/icons-react';
import { useLifePlan } from '../../hooks/useLifePlan.js';

function effectivenessColor(effectiveness) {
  if (effectiveness === 'effective') return 'green';
  if (effectiveness === 'mixed') return 'yellow';
  if (effectiveness === 'ineffective' || effectiveness === 'not_followed') return 'red';
  return 'gray';
}

function RuleItem({ rule }) {
  return (
    <Paper p="xs" withBorder>
      <Group justify="space-between">
        <Stack gap={2}>
          <Text size="sm" fw={500}>{rule.trigger}</Text>
          <Text size="xs" c="dimmed">{rule.action}</Text>
        </Stack>
        <Badge
          color={effectivenessColor(rule.effectiveness)}
          variant="light"
          size="sm"
        >
          {rule.effectiveness || 'untested'}
        </Badge>
      </Group>
    </Paper>
  );
}

export function QualitiesView({ username }) {
  const { plan, loading } = useLifePlan(username);

  if (loading) return null;

  const qualities = plan?.qualities || [];

  return (
    <Stack gap="md">
      <Title order={4}>Qualities</Title>

      {qualities.length === 0 && (
        <Text size="sm" c="dimmed">No qualities defined yet.</Text>
      )}

      <Accordion variant="separated">
        {qualities.map((q) => (
          <Accordion.Item key={q.id} value={q.id}>
            <Accordion.Control>
              <Group gap="sm">
                <ThemeIcon
                  color={q.shadow ? 'yellow' : 'blue'}
                  variant="light"
                  size="sm"
                >
                  {q.shadow ? <IconAlertTriangle size={14} /> : <IconShield size={14} />}
                </ThemeIcon>
                <Text size="sm" fw={500}>{q.name}</Text>
                {q.shadow && (
                  <Badge color="yellow" variant="light" size="xs">Has shadow</Badge>
                )}
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                {q.principles?.length > 0 && (
                  <div>
                    <Text size="xs" fw={500} mb={4}>Principles</Text>
                    {q.principles.map((p, i) => (
                      <Text key={i} size="xs" c="dimmed">- {p}</Text>
                    ))}
                  </div>
                )}

                {q.shadow && (
                  <Paper p="xs" withBorder bg="yellow.0">
                    <Text size="xs" fw={500}>Shadow: {q.shadow.name}</Text>
                    <Text size="xs" c="dimmed">{q.shadow.description}</Text>
                  </Paper>
                )}

                {q.rules?.length > 0 && (
                  <div>
                    <Text size="xs" fw={500} mb={4}>Rules</Text>
                    <Stack gap="xs">
                      {q.rules.map((r, i) => (
                        <RuleItem key={i} rule={r} />
                      ))}
                    </Stack>
                  </div>
                )}

                {q.grounded_in?.length > 0 && (
                  <Group gap="xs">
                    <Text size="xs" c="dimmed">Grounded in:</Text>
                    {q.grounded_in.map((ref, i) => (
                      <Badge key={i} variant="light" size="xs">{ref}</Badge>
                    ))}
                  </Group>
                )}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Stack>
  );
}
