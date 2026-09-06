import { DaylightAPI } from '../../../lib/api.mjs';

export const entryId = row => row.uuid || row.id;
export const entryVersions = row => Object.fromEntries([row, ...(row.kind === 'group' ? row.children || [] : [])]
  .map(item => [entryId(item), item.version ?? 1]));

export function updateEntry(row, changes, operationId) {
  return DaylightAPI(`api/v1/health/nutrilist/${entryId(row)}`, {
    ...changes, operationId, expectedVersion: row.version ?? 1, expectedVersions: entryVersions(row),
  }, 'PUT');
}

export const isEntryConflict = error => error?.status === 409 || /changed|conflict|409/i.test(error?.message || '');
export function entryError(error) {
  return isEntryConflict(error)
    ? 'This entry changed elsewhere. Reload it before applying your change.'
    : 'Could not save. Your change is still here; try again when connected.';
}
