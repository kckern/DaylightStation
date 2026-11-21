import { useState, useCallback, useMemo, useRef } from 'react';
import {
  Stack, Paper, Text, Group, Badge, ActionIcon,
  Button, TextInput, Alert,
} from '@mantine/core';
import { IconArrowUp, IconArrowDown } from '@tabler/icons-react';
import { useLifePlan } from "../../hooks/useLifePlan.js";
import { LifePage, LoadingState, ErrorState } from "../../components/index.js";
import { humanize } from "../../lib/format.js";
import { PlanCreateSheet } from "./PlanCreateSheet.jsx";
import { useLifeUsername } from "../../hooks/useLifeUser.js";
import { useLifePlanSubmission } from "../../hooks/LifePlanSubmissionContext.jsx";

function alignmentColor(state) {
  if (state === 'aligned') return 'green';
  if (state === 'drifting') return 'yellow';
  if (state === 'reconsidering') return 'red';
  return 'gray';
}

function ValueCreateSheet({ onClose, createValue, getFallbackFocusTarget }) {
  const [name, setName] = useState('');
  return (
    <PlanCreateSheet noun="value" onClose={onClose} save={() => createValue({ name: name.trim() })} valid={Boolean(name.trim())} getFallbackFocusTarget={getFallbackFocusTarget}>
      <TextInput
        label="Value"
        placeholder="What principle guides you?"
        required
        data-autofocus
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
      />
    </PlanCreateSheet>
  );
}

export function ValuesView({ username }) {
  const headingRef = useRef(null);
  const contextUsername = useLifeUsername();
  const { plan, loading, error, readError, refetch, updateSection, createValue } = useLifePlan(username);
  const { pending, run } = useLifePlanSubmission();
  const submissionKey = `${username || contextUsername || ''}:values`;
  const valuesPending = pending.has(submissionKey);

  const values = useMemo(() => plan?.values || [], [plan?.values]);

  const [opened, setOpened] = useState(false);
  const close = () => setOpened(false);
  const saveValue = useCallback(value => run(submissionKey, () => createValue(value)), [createValue, run, submissionKey]);

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
      await updateSection('values', updated, { waitForReadback: true });
    } catch {
      // The plan hook exposes the section update error to this view.
    }
  }, [values, updateSection]);

  const actions = (!loading && !readError) || opened
    ? <Button disabled={valuesPending} onClick={() => setOpened(true)}>Add value</Button> : undefined;
  let content;
  if (loading) content = <LoadingState />;
  else if (readError) content = <ErrorState label="Values" error={readError} onRetry={refetch} />;
  else content = (
    <>
      {error && <Alert color="red" title="Couldn’t reorder values">{error}</Alert>}
      {valuesPending && <Text size="sm" role="status">Saving value changes…</Text>}
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
                  className="ds-touch-target"
                  variant="subtle"
                  size="sm"
                  aria-label={`Move ${v.name} up`}
                  disabled={valuesPending || i === 0}
                  onClick={() => run(submissionKey, () => moveValue(i, -1))}
                >
                  <IconArrowUp size={14} />
                </ActionIcon>
                <ActionIcon
                  className="ds-touch-target"
                  variant="subtle"
                  size="sm"
                  aria-label={`Move ${v.name} down`}
                  disabled={valuesPending || i === values.length - 1}
                  onClick={() => run(submissionKey, () => moveValue(i, 1))}
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

            {v.conflicts_with?.length > 0 && (
              <Group gap="xs" mt="xs">
                <Text size="xs" c="red">Conflicts:</Text>
                {v.conflicts_with.map((c, j) => (
                  <Badge key={j} variant="light" size="xs" color="red">{humanize(c)}</Badge>
                ))}
              </Group>
            )}
          </Paper>
        ))}
      </Stack>
    </>
  );

  return (
    <>
      <LifePage title="Values" titleRef={headingRef} actions={actions} scrollReady={!loading && !readError}>
        {content}
      </LifePage>
      {opened && <ValueCreateSheet createValue={saveValue} onClose={close} getFallbackFocusTarget={() => headingRef.current} />}
    </>
  );
}
