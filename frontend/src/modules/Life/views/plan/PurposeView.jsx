import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Stack, Paper, Text, Group, Badge, Button, Textarea, ActionIcon } from '@mantine/core';
import { IconEdit, IconCheck, IconX, IconCompass } from '@tabler/icons-react';
import { useLifePlan } from '../../hooks/useLifePlan.js';
import { LifePage, LoadingState, EmptyState } from '../../components/index.js';
import { formatDate, humanize } from '../../lib/format.js';

export function PurposeView({ username }) {
  const navigate = useNavigate();
  const { plan, loading, updateSection } = useLifePlan(username);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (loading) return <LoadingState />;

  const purpose = plan?.purpose;

  const startEdit = () => {
    setDraft(purpose?.statement || '');
    setEditing(true);
  };

  const saveEdit = async () => {
    await updateSection('purpose', { ...purpose, statement: draft });
    setEditing(false);
  };

  const actions = !editing && (
    <ActionIcon variant="subtle" onClick={startEdit}>
      <IconEdit size={18} />
    </ActionIcon>
  );

  if (!purpose?.statement && !editing) {
    return (
      <LifePage title="Purpose" actions={actions}>
        <EmptyState
          icon={IconCompass}
          message="Your purpose statement is the 'why' behind everything else. Your coach can help you draft your first one."
          cta={<Button onClick={() => navigate('/life/coach')}>Talk to your coach</Button>}
        />
      </LifePage>
    );
  }

  return (
    <LifePage title="Purpose" actions={actions}>
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
            {purpose?.statement}
          </Text>
        )}
      </Paper>

      {(purpose?.grounded_in?.beliefs?.length > 0 || purpose?.grounded_in?.values?.length > 0) && (
        <Paper p="sm" withBorder>
          <Text size="sm" fw={500} mb="xs">Grounded In</Text>
          <Group gap="xs">
            {purpose.grounded_in.beliefs?.map((ref, i) => (
              <Badge key={`b-${i}`} variant="light" size="sm">{humanize(ref)}</Badge>
            ))}
            {purpose.grounded_in.values?.map((ref, i) => (
              <Badge key={`v-${i}`} variant="light" size="sm" color="green">{humanize(ref)}</Badge>
            ))}
          </Group>
        </Paper>
      )}

      {purpose?.last_reviewed && (
        <Text size="xs" c="dimmed">
          Last reviewed: {formatDate(purpose.last_reviewed)}
        </Text>
      )}
    </LifePage>
  );
}
