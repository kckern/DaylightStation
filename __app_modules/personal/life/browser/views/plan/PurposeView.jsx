import { useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Stack, Paper, Text, Group, Badge, Button, Textarea, ActionIcon, Alert } from '@mantine/core';
import { IconEdit, IconCheck, IconX } from '@tabler/icons-react';
import { SubmitButton, useSheetSubmission } from '@/lib/ui';
import { useLifePlan } from "../../hooks/useLifePlan.js";
import { LifePage, LoadingState, ErrorState, EmptyState } from "../../components/index.js";
import { formatDate, humanize } from "../../lib/format.js";

export function PurposeView({ username }) {
  const navigate = useNavigate();
  const { plan, loading, error, refetch, setPurpose } = useLifePlan(username);
  const [editVisit, setEditVisit] = useState(null);
  const [draft, setDraft] = useState('');
  const [submittedVisit, setSubmittedVisit] = useState(null);
  const { run: submit, saving, failure } = useSheetSubmission(null);
  const pendingHere = saving && submittedVisit === editVisit;
  const saveError = submittedVisit === editVisit ? failure : null;
  const editButton = useRef(null);
  const editor = useRef(null);
  const returnFocus = useRef(false);

  useLayoutEffect(() => {
    if (editVisit || loading || !returnFocus.current) return;
    returnFocus.current = false;
    const button = editButton.current;
    if (button && button.ownerDocument.activeElement === button.ownerDocument.body) button.focus();
  }, [editVisit, loading]);

  // Keep the focused editor mounted while a committed save refreshes the plan.
  if (loading && !editVisit) return <LoadingState />;
  if (error) return <LifePage title="Purpose" scrollReady={false}><ErrorState label="Purpose" error={error} onRetry={refetch} /></LifePage>;

  const purpose = plan?.purpose;

  const startEdit = () => {
    setDraft(purpose?.statement || '');
    setEditVisit({});
  };

  const cancelEdit = () => {
    returnFocus.current = true;
    setEditVisit(null);
  };

  const saveEdit = () => {
    const submittedEditor = editor.current;
    return submit(() => {
      setSubmittedVisit(editVisit);
      return setPurpose(draft);
    }, {
      valid: Boolean(submittedEditor),
      onSuccess: () => {
        if (editor.current === submittedEditor) {
          returnFocus.current = submittedEditor.contains(submittedEditor.ownerDocument.activeElement);
        }
        setEditVisit(current => current === editVisit ? null : current);
      },
    });
  };

  const actions = !editVisit && (
    <ActionIcon ref={editButton} className="ds-touch-target" variant="subtle" aria-label="Edit purpose" data-testid="edit" onClick={startEdit}>
      <IconEdit size={18} />
    </ActionIcon>
  );

  if (!purpose?.statement && !editVisit) {
    return (
      <LifePage title="Purpose" actions={actions}>
        <EmptyState
          title="Purpose"
          hint="Your purpose statement is the 'why' behind everything else. Your coach can help you draft your first one."
          action={{ label: 'Talk to your coach', onClick: () => navigate('/life/coach') }}
        />
      </LifePage>
    );
  }

  return (
    <LifePage title="Purpose" actions={actions}>
      <Paper p="md" withBorder>
        {editVisit ? (
          <Stack ref={editor} gap="sm">
            {saveError && (
              <Alert color="red" title="Couldn't save your purpose">{saveError.message}</Alert>
            )}
            <Textarea
              aria-label="Purpose statement"
              autoFocus
              readOnly={pendingHere}
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
              autosize
              minRows={2}
            />
            <Group>
              <SubmitButton
                as={Button}
                type="button"
                className="ds-touch-target"
                size="xs"
                leftSection={<IconCheck size={14} />}
                pending={pendingHere}
                blocked={saving && !pendingHere}
                onClick={saveEdit}
              >
                Save
              </SubmitButton>
              <Button className="ds-touch-target" size="xs" variant="subtle" leftSection={<IconX size={14} />} onClick={cancelEdit}>
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
