import { useId, useState } from 'react';
import { localDateKey } from '@/lib/calendarDay.js';
import { Stack, Paper, Text, Group, Badge, Progress, Button, TextInput, Select } from '@mantine/core';
import { IconFlask } from '@tabler/icons-react';
import { Button as FormButton, Sheet, StateMessage, SubmitButton, createAppLogger, useSheetSubmission } from '@/lib/ui';
import { useBeliefs } from "../../hooks/useLifePlan.js";
import { beliefConfidenceColor } from "../../theme/semantics.js";
import { LifePage, LoadingState, ErrorState } from "../../components/index.js";
import { formatDate } from "../../lib/format.js";
import { PlanCreateSheet } from "./PlanCreateSheet.jsx";

const logger = createAppLogger('life').child('belief-evidence');

function BeliefEvidenceSheet({ beliefId, onClose, addEvidence }) {
  const [type, setType] = useState('confirmation');
  const [note, setNote] = useState('');
  const { submit, saving, failure } = useSheetSubmission(onClose, error => {
    logger.warn('submit.failed', { beliefId, error: error?.message });
  });
  const save = () => addEvidence(beliefId, { type, note, date: localDateKey() });

  return (
    <Sheet open onClose={onClose} title="Add Evidence">
      <Stack component="form" aria-label="Add Evidence" gap="sm" onSubmit={event => submit(event, save, Boolean(type))}>
        {failure && (
          <StateMessage state="error" role="alert" title="Couldn't add evidence" detail={failure.message} />
        )}
        <Select
          label="Type"
          data={[
            { value: 'confirmation', label: 'Confirmation' },
            { value: 'disconfirmation', label: 'Disconfirmation' },
            { value: 'spurious', label: 'Spurious' },
          ]}
          value={type}
          onChange={setType}
          disabled={saving}
          allowDeselect={false}
          comboboxProps={{ withinPortal: false }}
          data-autofocus
        />
        <TextInput label="Note" value={note} onChange={event => setNote(event.currentTarget.value)} disabled={saving} />
        <Group justify="flex-end">
          <FormButton density="compact" variant="secondary" onClick={onClose}>Cancel</FormButton>
          <SubmitButton density="compact" pending={saving}>
            {saving ? 'Submitting…' : 'Submit'}
          </SubmitButton>
        </Group>
      </Stack>
    </Sheet>
  );
}

function stateColor(state) {
  const map = {
    hypothesized: 'blue', testing: 'cyan', confirmed: 'green',
    refuted: 'red', questioning: 'yellow', dormant: 'gray',
    cascade_questioning: 'orange', cascade_refuted: 'red', archived: 'dark',
  };
  return map[state] || 'gray';
}

function EvidenceTimeline({ history = [] }) {
  if (history.length === 0) return <Text size="xs" c="dimmed">No evidence yet</Text>;

  const recent = history.slice(-5).reverse();
  return (
    <Stack gap={4}>
      {recent.map((e, i) => (
        <Group key={i} gap="xs">
          <Badge size="xs" color={e.type === 'confirmation' ? 'green' : e.type === 'disconfirmation' ? 'red' : 'yellow'}>
            {e.type}
          </Badge>
          <Text size="xs" c="dimmed">{formatDate(e.date) || 'undated'}</Text>
          {e.note && <Text size="xs">{e.note}</Text>}
        </Group>
      ))}
    </Stack>
  );
}

function BeliefCreateSheet({ onClose, createBelief }) {
  const [ifHypothesis, setIfHypothesis] = useState('');
  const [thenOutcome, setThenOutcome] = useState('');
  const valid = Boolean(ifHypothesis.trim() && thenOutcome.trim());
  const save = () => createBelief({ if_hypothesis: ifHypothesis.trim(), then_outcome: thenOutcome.trim() });

  return (
    <PlanCreateSheet noun="belief" onClose={onClose} save={save} valid={valid}>
      <TextInput
        label="If I…"
        placeholder="practice piano every morning"
        required
        data-autofocus
        value={ifHypothesis}
        onChange={(e) => setIfHypothesis(e.currentTarget.value)}
      />
      <TextInput
        label="…then"
        placeholder="I'll be recital-ready by spring"
        required
        value={thenOutcome}
        onChange={(e) => setThenOutcome(e.currentTarget.value)}
      />
    </PlanCreateSheet>
  );
}

export function BeliefsView({ username }) {
  const { beliefs, loading, error, refetch, addEvidence, createBelief } = useBeliefs(username);
  const beliefDescriptionPrefix = useId();
  const [addingTo, setAddingTo] = useState(null);
  const [creating, setCreating] = useState(false);
  const close = () => setCreating(false);

  const hasBeliefs = beliefs.length > 0;
  const initialLoading = loading && !hasBeliefs;
  const readError = error && <ErrorState label="Beliefs" error={error} onRetry={refetch} />;
  const actions = (!initialLoading && !error) || creating
    ? <Button onClick={() => setCreating(true)}>Add belief</Button> : undefined;
  let content;
  if (initialLoading) content = <LoadingState />;
  else if (error && !hasBeliefs) content = readError;
  else content = (
    <>
      {readError}
      {!hasBeliefs && (
        <Text size="sm" c="dimmed">No beliefs defined yet — add a hypothesis to start testing it.</Text>
      )}

      <Stack gap="sm">
        {beliefs.map(b => {
          const effectiveConf = b.effective_confidence ?? b.confidence ?? 0;
          const statementId = `${beliefDescriptionPrefix}-statement-${b.id}`;
          const outcomeId = `${beliefDescriptionPrefix}-outcome-${b.id}`;
          return (
            <Paper key={b.id} p="sm" withBorder>
              <Group justify="space-between" mb="xs">
                <Stack gap={2} style={{ flex: 1 }}>
                  <Text size="sm" fw={500} id={statementId}>
                    If {b.if}
                  </Text>
                  {b.then && (
                    <Text size="xs" c="dimmed" id={outcomeId}>Then {b.then}</Text>
                  )}
                </Stack>
                <Group gap="xs">
                  <Badge color={stateColor(b.state)} variant="light" size="sm">
                    {b.state}
                  </Badge>
                  {b.foundational && (
                    <Badge color="violet" variant="filled" size="xs">foundational</Badge>
                  )}
                </Group>
              </Group>

              <Group gap="md" mb="xs">
                <Stack gap={2} style={{ flex: 1 }}>
                  <Group justify="space-between">
                    <Text size="xs">Confidence</Text>
                    <Text size="xs" fw={500}>{Math.round(effectiveConf * 100)}%</Text>
                  </Group>
                  <Progress
                    value={effectiveConf * 100}
                    color={beliefConfidenceColor(effectiveConf)}
                    size="sm"
                    aria-label={`Confidence for belief: If ${b.if}`}
                  />
                </Stack>
              </Group>

              <EvidenceTimeline history={b.evidence_history} />

              <Group mt="xs">
                <Button
                  size="xs"
                  variant="subtle"
                  leftSection={<IconFlask size={14} />}
                  aria-describedby={b.then ? `${statementId} ${outcomeId}` : statementId}
                  onClick={() => setAddingTo(b.id)}
                >
                  Add Evidence
                </Button>
              </Group>
            </Paper>
          );
        })}
      </Stack>
    </>
  );

  return (
    <>
      <LifePage title="Beliefs" actions={actions} scrollReady={hasBeliefs || (!initialLoading && !error)}>
        {content}
      </LifePage>
      {creating && <BeliefCreateSheet createBelief={createBelief} onClose={close} />}
      {addingTo && <BeliefEvidenceSheet beliefId={addingTo} addEvidence={addEvidence} onClose={() => setAddingTo(null)} />}
    </>
  );
}
