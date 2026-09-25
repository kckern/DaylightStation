import { useEffect, useRef, useState } from 'react';
import { Button, Group, Stack, Text, Textarea } from '@mantine/core';
import { SectionCard } from '../../../lib/ui';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { refreshHealthResources } from '../healthResources.js';

export const cleanupPath = 'api/v1/health/nutrition/cleanup';
export function useCleanup(active = true) {
  const resource = useApiResource(cleanupPath, { enabled: active, swr: true });
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(resource.reload, 15000);
    return () => clearInterval(timer);
  }, [active, resource.reload]);
  return resource;
}

export function RepairPreview({ repair, entryNames = {} }) {
  return <Stack gap="xs">
    {(repair?.updates || []).map(update => <Text size="sm" key={update.id}>
      {entryNames[update.id] || update.id}: {Object.entries(update.changes).map(([field, value]) => `${field}: ${value ?? 'none'}`).join(', ')}
    </Text>)}
    {(repair?.createGroups || []).map((group, i) => <Text size="sm" key={i}>Group as “{group.label}” ({group.children.length} items)</Text>)}
  </Stack>;
}

/**
 * Answer one cleanup question: a choice (`{choiceId}`), free text (`{text}`)
 * or leave it unchanged (`{dismiss: true}`). One operation id per distinct
 * payload, so a retry of the same answer is idempotent. Shared by the Settings
 * list and the Today card deck.
 */
export function useQuestionAnswer({ question, onChanged = () => {}, onFeedback = () => {} }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const operation = useRef(null);
  const answer = async payload => {
    if (busy) return false;
    setBusy(true); setError(null);
    const signature = JSON.stringify(payload);
    if (operation.current?.signature !== signature) operation.current = { signature, id: crypto.randomUUID() };
    try {
      const result = await DaylightAPI(`${cleanupPath}/questions/${question.id}/answer`, {
        ...payload, expectedVersion: question.version, operationId: operation.current.id,
      }, 'POST');
      if (result.status === 'stale') onFeedback(result.outcome?.message || 'The entry changed. Please review it manually.');
      refreshHealthResources(); onChanged();
      return true;
    } catch (err) { setError(err.message); return false; }
    finally { setBusy(false); }
  };
  return { answer, busy, error, disabled: busy || question.status === 'answering' };
}

function Question({ question, onChanged, onFeedback }) {
  const [text, setText] = useState('');
  const { answer, busy, error, disabled } = useQuestionAnswer({ question, onChanged, onFeedback });
  return <SectionCard title={question.question}>
    <Stack gap="sm">
      <Text size="sm" c="dimmed">Optional: your current estimate already counts. Without an answer, it stabilizes automatically after its 72-hour review window.</Text>
      {question.choices.map(choice => <Stack gap="xs" key={choice.id}>
        <RepairPreview repair={choice.repair} entryNames={question.entryNames} />
        <Button variant="light" disabled={disabled} onClick={() => answer({ choiceId: choice.id })}>{choice.label}</Button>
      </Stack>)}
      <Textarea label="Your answer" value={text} onChange={event => setText(event.target.value)} maxLength={4000} disabled={disabled} autosize />
      {question.status === 'answering' ? <Text size="sm" role="status">Processing your answer…</Text> : null}
      {error ? <Text c="red" role="alert">{error}</Text> : null}
      <Group>
        <Button disabled={disabled || !text.trim()} loading={busy} onClick={() => answer({ text: text.trim() })}>Send answer</Button>
        <Button variant="subtle" disabled={disabled} onClick={() => answer({ dismiss: true })}>Leave unchanged</Button>
      </Group>
    </Stack>
  </SectionCard>;
}

// `resource` lets a host that already polls (the Today follow-up tray, which
// needs the count) share its poll instead of starting a second one.
// `feedback`/`onFeedback` let that host hold the "entry changed" message too:
// answering the last question empties the list, and a host that unmounts the
// questions when there are none would otherwise take the message with it.
export function CleanupQuestions({ active = true, onChanged = () => {}, resource: shared = null, feedback: heldFeedback, onFeedback }) {
  const own = useCleanup(active && !shared);
  const resource = shared || own;
  const [ownFeedback, setOwnFeedback] = useState(null);
  const feedback = onFeedback ? heldFeedback : ownFeedback;
  const setFeedback = onFeedback || setOwnFeedback;
  if (!resource.data?.questions?.length && !feedback) return null;
  return <section aria-label="Cleanup questions"><Stack gap="sm">
    {feedback ? <Text role="status">{feedback}</Text> : null}
    {(resource.data?.questions || []).map(question => <Question key={question.id} question={question} onFeedback={setFeedback} onChanged={() => { resource.reload(); onChanged(); }} />)}
  </Stack></section>;
}
