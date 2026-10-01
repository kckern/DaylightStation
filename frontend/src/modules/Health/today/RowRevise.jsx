import { useRef, useState } from 'react';
import { Button, CloseButton, Group, Stack, Text, TextInput } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { VoiceCapture } from '../capture/VoiceCapture.jsx';
import { ReviseField } from './ReviseField.jsx';
import { entryId, entryLabel, updateEntry } from './entryCommands.js';

const logger = createAppLogger('health').child('row-revise');
const UNDO_FIELDS = ['name', 'icon', 'color', 'grams', 'amount', 'unit', 'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol'];
const list = names => names.join(', ');

/**
 * The row menu's Revise, opened in place under the row: say or type what the
 * food really was and it is re-derived in one gesture.
 *
 *   A food   — ReviseField (re-describe the one row), plus an Undo that writes
 *              the row's previous values back.
 *   A dish   — its PARTS are rebuilt from the correction ("the soup didn't
 *              have noodles, the base was broth, chicken and tofu"): kept,
 *              changed, removed, added. The server commits it through the
 *              audited meal amend; the returned undoToken drives the page's
 *              "Meal updated · Undo" banner via onChanged.
 */
export function RowRevise({ row, isGroup, onClose, onChanged, onReload }) {
  return <div className="health-row-revise" data-testid="row-revise">
    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
      {isGroup ? <DishRevise row={row} onChanged={onChanged} /> : <FoodRevise row={row} onReload={onReload} />}
      <CloseButton size="sm" aria-label="Close revise" onClick={onClose} />
    </Group>
  </div>;
}

function FoodRevise({ row, onReload }) {
  const [undo, setUndo] = useState(null); // { before, after }
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState(null);
  const undoChange = async () => {
    if (!undo || undoing) return;
    setUndoing(true); setError(null);
    try {
      await updateEntry(undo.after, undo.before, crypto.randomUUID());
      logger.info('revise.food.undone', { uuid: entryId(row) });
      setUndo(null); onReload?.();
    } catch (err) {
      setError(err.message || 'Could not undo that.');
      logger.warn('revise.food.undo_failed', { uuid: entryId(row), error: err.message });
    } finally { setUndoing(false); }
  };
  return <Stack gap={4} className="health-row-revise__body">
    <ReviseField row={row} onApply={async (changes, meta) => {
      const before = Object.fromEntries(UNDO_FIELDS.filter(field => Object.hasOwn(changes, field)).map(field => [field, row[field] ?? null]));
      const result = await updateEntry(row, { ...changes, ...meta }, crypto.randomUUID());
      setUndo(result?.data ? { before, after: result.data } : null);
      onReload?.();
    }} />
    {undo ? <Group gap="xs"><Button size="compact-xs" variant="subtle" loading={undoing} onClick={undoChange}>Undo</Button></Group> : null}
    {error ? <Text size="xs" role="alert" c="red">{error}</Text> : null}
  </Stack>;
}

function DishRevise({ row, onChanged }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const running = useRef(false);
  const revise = async (body) => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(null); setOutcome(null);
    logger.info('revise.dish.start', { uuid: entryId(row), spoken: Boolean(body.audio) });
    try {
      const result = await DaylightAPI(`api/v1/health/nutrilist/${entryId(row)}/revise-dish`, { ...body, operationId: crypto.randomUUID() }, 'POST');
      setText('');
      setOutcome({ heard: result.instruction || body.instruction, removed: result.removed || [], added: result.added || [], changed: result.changed || [] });
      logger.info('revise.dish.applied', { uuid: entryId(row), removed: result.removed?.length, added: result.added?.length, changed: result.changed?.length });
      onChanged?.(result);
    } catch (err) {
      setError(err.message || 'Could not work that out. Try saying it another way.');
      logger.warn('revise.dish.failed', { uuid: entryId(row), error: err.message });
    } finally { running.current = false; setBusy(false); }
  };
  return <Stack gap={4} className="health-row-revise__body">
    <Group gap="xs" align="flex-end" wrap="nowrap">
      <TextInput className="health-revise__input" label={`What was really in ${entryLabel(row)}?`} placeholder="e.g. no noodles; the base was broth, chicken and tofu"
        value={text} disabled={busy} data-autofocus onChange={event => setText(event.currentTarget.value)}
        onKeyDown={event => { if (event.key === 'Enter' && text.trim()) { event.preventDefault(); revise({ instruction: text.trim() }); } }} />
      <VoiceCapture active labelPrefix={`Say what was really in ${entryLabel(row)}`} busy={busy}
        className="health-revise__mic" onCapture={dataUrl => revise({ audio: dataUrl })} />
      <Button size="compact-sm" disabled={busy || !text.trim()} loading={busy} onClick={() => revise({ instruction: text.trim() })}>Rework</Button>
    </Group>
    {outcome ? <Text size="xs" c="dimmed" role="status">
      {/* What it HEARD first: a mis-transcription is otherwise indistinguishable from a misread. */}
      Heard “{outcome.heard}”
      {outcome.removed.length ? ` · removed ${list(outcome.removed)}` : ''}
      {outcome.added.length ? ` · added ${list(outcome.added)}` : ''}
      {outcome.changed.length ? ` · adjusted ${list(outcome.changed)}` : ''}
    </Text> : null}
    {error ? <Text size="xs" role="alert" c="red">{error}</Text> : null}
  </Stack>;
}

export default RowRevise;
