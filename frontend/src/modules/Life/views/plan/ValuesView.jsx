import { useState, useCallback } from 'react';
import {
  Stack, Paper, Text, Group, Badge, ActionIcon,
  Button, Modal, TextInput, Alert,
} from '@mantine/core';
import { IconArrowUp, IconArrowDown } from '@tabler/icons-react';
import { useLifePlan } from '../../hooks/useLifePlan.js';
import { LifePage, LoadingState } from '../../components/index.js';
import { humanize } from '../../lib/format.js';

function alignmentColor(state) {
  if (state === 'aligned') return 'green';
  if (state === 'drifting') return 'yellow';
  if (state === 'reconsidering') return 'red';
  return 'gray';
}

export function ValuesView({ username }) {
  const { plan, loading, updateSection, createValue } = useLifePlan(username);

  const values = plan?.values || [];

  const [opened, setOpened] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const closeModal = () => {
    setOpened(false);
    setName('');
    setFormError(null);
  };

  const handleSubmit = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await createValue({ name: name.trim() });
      closeModal();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

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
    try {
      await updateSection('values', updated);
    } catch {
      // updateSection() records the failure in useLifePlan's internal `error`
      // state (which this view doesn't currently surface); swallow here so a
      // failed reorder doesn't become an unhandled promise rejection now that
      // updateSection() rethrows for callers (e.g. PurposeView) that do want it.
    }
  }, [values, updateSection]);

  if (loading) return <LoadingState />;

  return (
    <LifePage title="Values" actions={<Button onClick={() => setOpened(true)}>Add value</Button>}>
      {values.length === 0 && (
        <Text size="sm" c="dimmed">No values defined yet — add one to rank what matters most.</Text>
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
                  <Badge key={j} variant="light" size="xs">{humanize(ref)}</Badge>
                ))}
              </Group>
            )}

            {v.conflicts?.length > 0 && (
              <Group gap="xs" mt="xs">
                <Text size="xs" c="red">Conflicts:</Text>
                {v.conflicts.map((c, j) => (
                  <Badge key={j} variant="light" size="xs" color="red">{humanize(c)}</Badge>
                ))}
              </Group>
            )}
          </Paper>
        ))}
      </Stack>

      <Modal opened={opened} onClose={closeModal} title="Add value">
        <Stack gap="sm">
          {formError && (
            <Alert color="red" title="Couldn't create the value">{formError}</Alert>
          )}
          <TextInput
            label="Value"
            placeholder="What principle guides you?"
            required
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={closeModal}>Cancel</Button>
            <Button onClick={handleSubmit} loading={submitting} disabled={!name.trim()}>
              Create value
            </Button>
          </Group>
        </Stack>
      </Modal>
    </LifePage>
  );
}
