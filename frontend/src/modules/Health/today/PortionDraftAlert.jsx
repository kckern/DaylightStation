import { Button } from '@mantine/core';
import { entryId } from './entryCommands.js';

// Is the entry a portion draft edits still on this day (top level or inside a group)?
export function dayHasEntry(items, id) {
  return items.some(row => String(entryId(row)) === String(id) || (row.children && dayHasEntry(row.children, id)));
}

// Has the draft something to say? A draft that is simply being edited is silent.
export const draftHasAlert = draft => Boolean(draft && (draft.validationError || draft.status === 'error'));

// Does this alert belong on `row`?
export const portionAlertFor = (control, row) => draftHasAlert(control?.draft)
  && String(entryId(control.draft.row)) === String(entryId(row));

/**
 * A portion/number edit that could not be applied, said ON the entry it was
 * about. It was once a banner at the top of the day, which pushed every meal
 * below it down the page. TodayView keeps a toast fallback for a draft whose
 * entry is no longer on the day — it has no row to sit on.
 */
export function PortionDraftAlert({ control, onReload, className = 'health-portion-error' }) {
  const draft = control?.draft;
  if (!draftHasAlert(draft)) return null;
  if (draft.validationError) return <div role="alert" className={className}>
    <span>{draft.validationError}</span>
    <Button size="compact-xs" onClick={() => control.cancel()}>Discard change</Button>
  </div>;
  return <div role="alert" className={className}>
    <span>{draft.error} Intended {draft.numericEdit ? `${draft.numericEdit.field}: ${draft.numericEdit.value}` : `portion: ${draft.portion.value} ${draft.portion.unit}`}.</span>
    <Button size="compact-xs" onClick={() => control.retry()}>{draft.conflict ? 'Reload & apply intended change' : 'Retry same change'}</Button>
    <Button size="compact-xs" variant="subtle" onClick={() => { control.cancel(); (onReload || control.reloadDay)?.(); }}>Discard draft &amp; reload</Button>
  </div>;
}
