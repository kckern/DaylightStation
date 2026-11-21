import { Button } from '@mantine/core';
import { entryId } from "./entryCommands.js";
import { SubmitButton } from '../../../../../frontend/src/lib/ui/SubmitButton.jsx';

// Is the entry a portion draft edits still on this day (top level or inside a group)?
export function dayHasEntry(items, id) {
  return items.some(row => String(entryId(row)) === String(id) || (row.children && dayHasEntry(row.children, id)));
}

const recovering = draft => draft.status === 'reloading' || (draft.status === 'saving' && draft.error != null);

// Keep the same action mounted through an explicit retry of a refused draft.
export const draftHasAlert = draft => Boolean(draft && (draft.validationError || draft.status === 'error' || recovering(draft)));

// Does this alert belong on `row`?
export const portionAlertFor = (control, row) => draftHasAlert(control?.draft)
  && String(entryId(control.draft.row)) === String(entryId(row));

/**
 * A portion/number edit that could not be applied, said ON the entry it was
 * about. It was once a banner at the top of the day, which pushed every meal
 * below it down the page. TodayView keeps a toast fallback for a draft whose
 * entry is no longer on the day — it has no row to sit on.
 */
// `role={null}` inside a container that is already the alert (a toast).
export function PortionDraftAlert({ control, onReload, className = 'health-portion-error', role = 'alert' }) {
  const draft = control?.draft;
  if (!draftHasAlert(draft)) return null;
  if (draft.validationError) return <div role={role || undefined} className={className}>
    <span>{draft.validationError}</span>
    <Button size="compact-xs" onClick={() => control.cancel()}>Discard change</Button>
  </div>;
  const pending = recovering(draft);
  return <div role={role || undefined} className={className}>
    <span>{draft.error} Intended {draft.numericEdit ? `${draft.numericEdit.field}: ${draft.numericEdit.value}` : `portion: ${draft.portion.value} ${draft.portion.unit}`}.</span>
    <SubmitButton as={Button} type="button" size="compact-xs" pending={pending} data-portion-retry onClick={() => control.retry()}>
      {draft.conflict ? 'Reload & apply intended change' : 'Retry same change'}
    </SubmitButton>
    <Button size="compact-xs" variant="subtle" disabled={pending}
      onClick={() => { control.cancel(); (onReload || control.reloadDay)?.(); }}>Discard draft &amp; reload</Button>
  </div>;
}
