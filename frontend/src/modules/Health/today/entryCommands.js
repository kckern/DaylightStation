import { DaylightAPI } from '../../../lib/api.mjs';

export const entryId = row => row.uuid || row.id;
export const entryVersions = row => Object.fromEntries([row, ...(row.kind === 'group' ? row.children || [] : [])]
  .map(item => [entryId(item), item.version ?? 1]));

export function updateEntry(row, changes, operationId) {
  return DaylightAPI(`api/v1/health/nutrilist/${entryId(row)}`, {
    ...changes, operationId, expectedVersion: row.version ?? 1, expectedVersions: entryVersions(row),
  }, 'PUT');
}

export const entryLabel = row => row.name || row.item || row.label || 'this entry';

/**
 * The fields this person has corrected by hand, in the order the row records
 * them. Read from the row rather than asked of the server, so the revise field
 * can name them before you have said anything — a pin discovered only after a
 * correction did nothing is the dead end this list exists to prevent.
 *
 * `cleanupFields` counts too: a name the auditor settled with you is as pinned
 * as one you typed.
 */
export const entryPins = row => [...new Set([...(row?.manualFields || []), ...(row?.cleanupFields || [])])];

/**
 * How many rows a delete will take with it, for the sentence the user reads.
 *
 * Display only. The SERVER decides what actually cascades and reports it back as
 * `affectedIds`; that is what Undo restores. Counting here is about never
 * offering "Delete Asian Chicken Plate?" for a gesture that removes five rows.
 *
 * Gated on `kind === 'group'`, deliberately matching EntryEditSheet and the
 * backend cascade rather than LogTable's has-children test — this decides what a
 * destructive sentence CLAIMS, so it follows the same rule as the code that does
 * the destroying. A row with children that nothing marked as a group is not one.
 */
export const entryChildCount = row => (row.kind === 'group' ? row.children?.length || 0 : 0);

export function deleteConfirmBody(row) {
  const count = entryChildCount(row);
  const name = entryLabel(row);
  return count
    ? `Delete “${name}” and its ${count} item${count === 1 ? '' : 's'}? You can undo this straight after.`
    : `Delete “${name}”? You can undo this straight after.`;
}

/**
 * Delete one entry (and whatever the server cascades with it).
 *
 * Returns the shape TodayView's Undo banner consumes, so the row X and the edit
 * sheet's Delete produce identical results — they used to be two call sites with
 * two different contracts for one action.
 */
export async function deleteEntry(row) {
  const id = entryId(row);
  const result = await DaylightAPI(`api/v1/health/nutrilist/${id}`, {}, 'DELETE');
  return { entryIds: result.affectedIds || [id], label: entryLabel(row) };
}

export const isEntryConflict = error => error?.status === 409 || /changed|conflict|409/i.test(error?.message || '');
export function entryError(error) {
  return isEntryConflict(error)
    ? 'This entry changed elsewhere. Reload it before applying your change.'
    : 'Could not save. Your change is still here; try again when connected.';
}
