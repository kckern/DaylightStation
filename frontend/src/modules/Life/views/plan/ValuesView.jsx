import { useState, useCallback } from 'react';
import { Stack, Paper, Title, Text, Group, Badge, ActionIcon } from '@mantine/core';
import { IconArrowUp, IconArrowDown } from '@tabler/icons-react';
import { useLifePlan } from '../../hooks/useLifePlan.js';

function alignmentColor(state) {
  if (state === 'aligned') return 'green';
  if (state === 'drifting') return 'yellow';
  if (state === 'reconsidering') return 'red';
  return 'gray';
}

export function ValuesView({ username }) {
  const { plan, loading, updateSection } = useLifePlan(username);

  if (loading) return null;

  const values = plan?.values || [];

  const moveValue = useCallback(async (index, direction) => {
    const newValues = [...values];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= newValues.length) return;

    // Swap ranks
    const temp = newValues[index];
    newValues[index] = newValues[targetIndex];
    newValues[targetIndex] = temp;

    // Update rank numbers
    const updated = newValues.map((v, i) => ({ ...v, rank: i + 1 }));
    await updateSection('values', updated);
  }, [values, updateSection]);

  return (
    <Stack gap="md">
      <Title order={4}>Values</Title>

      {values.length === 0 && (
        <Text size="sm" c="dimmed">No values defined yet.</Text>
      )}

      <Stack gap="sm">
        {values.map((v, i) => (
          <Paper key={v.id} p="sm" withBorder>
            <Group justify="space-between">
              <Group gap="sm">
                <Badge circle size="lg" variant="filled" color="blue">
                  {v.rank || i + 1}
                </Badge>
                <Stack gap={2}>
                  <Text size="sm" fw={500}>{v.name}</Text>
                  {v.description && (
                    <Text size="xs" c="dimmed">{v.description}</Text>
                  )}
                </Stack>
              </Group>

              <Group gap="xs">
                {v.alignment_state && (
                  <Badge
                    color={alignmentColor(v.alignment_state)}
                    variant="light"
                    size="sm"
                  >
                    {v.alignment_state}
                  </Badge>
                )}
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  disabled={i === 0}
                  onClick={() => moveValue(i, -1)}
                >
                  <IconArrowUp size={14} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  disabled={i === values.length - 1}
                  onClick={() => moveValue(i, 1)}
                >
                  <IconArrowDown size={14} />
                </ActionIcon>
              </Group>
            </Group>

            {v.justified_by?.length > 0 && (
              <Group gap="xs" mt="xs">
                <Text size="xs" c="dimmed">Justified by:</Text>
                {v.justified_by.map((ref, j) => (
                  <Badge key={j} variant="light" size="xs">{ref}</Badge>
                ))}
              </Group>
            )}

            {v.conflicts?.length > 0 && (
              <Group gap="xs" mt="xs">
                <Text size="xs" c="red">Conflicts:</Text>
                {v.conflicts.map((c, j) => (
                  <Badge key={j} variant="light" size="xs" color="red">{c}</Badge>
                ))}
              </Group>
            )}
          </Paper>
        ))}
      </Stack>
    </Stack>
  );
}
