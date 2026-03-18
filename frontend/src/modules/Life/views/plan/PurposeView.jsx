import { useState } from 'react';
import { Stack, Paper, Title, Text, Group, Badge, Button, Textarea, ActionIcon } from '@mantine/core';
import { IconEdit, IconCheck, IconX } from '@tabler/icons-react';
import { useLifePlan } from '../../hooks/useLifePlan.js';

export function PurposeView({ username }) {
  const { plan, loading, updateSection } = useLifePlan(username);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (loading) return null;

  const purpose = plan?.purpose;

  const startEdit = () => {
    setDraft(purpose?.statement || '');
    setEditing(true);
  };

  const saveEdit = async () => {
    await updateSection('purpose', { ...purpose, statement: draft });
    setEditing(false);
  };

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={4}>Purpose</Title>
        {!editing && (
          <ActionIcon variant="subtle" onClick={startEdit}>
            <IconEdit size={18} />
          </ActionIcon>
        )}
      </Group>

      <Paper p="md" withBorder>
        {editing ? (
          <Stack gap="sm">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
              autosize
              minRows={2}
            />
            <Group>
              <Button size="xs" leftSection={<IconCheck size={14} />} onClick={saveEdit}>
                Save
              </Button>
              <Button size="xs" variant="subtle" leftSection={<IconX size={14} />} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </Group>
          </Stack>
        ) : (
          <Text size="lg" fw={500}>
            {purpose?.statement || 'No purpose statement defined yet.'}
          </Text>
        )}
      </Paper>

      {(purpose?.grounded_in?.beliefs?.length > 0 || purpose?.grounded_in?.values?.length > 0) && (
        <Paper p="sm" withBorder>
          <Text size="sm" fw={500} mb="xs">Grounded In</Text>
          <Group gap="xs">
            {purpose.grounded_in.beliefs?.map((ref, i) => (
              <Badge key={`b-${i}`} variant="light" size="sm">{ref}</Badge>
            ))}
            {purpose.grounded_in.values?.map((ref, i) => (
              <Badge key={`v-${i}`} variant="light" size="sm" color="green">{ref}</Badge>
            ))}
          </Group>
        </Paper>
      )}

      {purpose?.last_reviewed && (
        <Text size="xs" c="dimmed">
          Last reviewed: {purpose.last_reviewed}
        </Text>
      )}
    </Stack>
  );
}
