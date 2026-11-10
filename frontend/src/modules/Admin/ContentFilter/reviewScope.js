/**
 * Pure rules of the review station: what a row's action is, which rows a scope (kind x action x
 * needs-review x group) keeps, which keys apply to a kind, and where the cursor steps next.
 * One scope drives the list, the timeline and cursor stepping.
 */
export const KIND_SCOPES = [{ label: 'All', value: 'all' }, { label: 'Words', value: 'words' }, { label: 'Picture', value: 'picture' }, { label: 'Scenes', value: 'scenes' }];
export const ACTION_SCOPES = [{ label: 'All actions', value: 'all' }, { label: 'Blur', value: 'blur' }, { label: 'Skip', value: 'skip' }, { label: 'Bleep', value: 'bleep' }, { label: 'Mute', value: 'mute' }];
export const DEFAULT_SCOPE = Object.freeze({ kind: 'all', action: 'all', needs: false, group: null });

const ACTION_OF = { mute: 'mute', bleep: 'bleep', blur: 'blur', 'full-blur': 'blur', blackout: 'blur', skip: 'skip', 'skip-card': 'skip' };
/** blur | skip | bleep | mute, or null (off / use settings). */
export const rowAction = (row) => ACTION_OF[row?.effect] || null;

/** A row has a verdict when the server says so (a moved span already cleared it there). */
export const hasVerdict = (row) => Boolean(row?.verdict || row?.reviewed);

export function inScope(row, scope = DEFAULT_SCOPE) {
  return (scope.kind === 'all' || row.kind === scope.kind)
    && (scope.action === 'all' || rowAction(row) === scope.action)
    && (!scope.group || row.group === scope.group)
    && (!scope.needs || !hasVerdict(row));
}
export const scopeRows = (rows, scope) => (rows || []).filter((r) => inScope(r, scope));

/** F cycles the kind scope. */
export function nextKind(kind) {
  const order = KIND_SCOPES.map((k) => k.value);
  return order[(order.indexOf(kind) + 1) % order.length];
}

/** Contextual action keys for a kind: [key, label, effect value to apply]. Widen applies to every kind. */
const ACTION_KEYS = {
  words: [['M', 'Mute', 'mute'], ['P', 'Bleep', 'bleep']],
  picture: [['B', 'Blur', 'blur'], ['K', 'Skip', 'skip']],
  scenes: [['K', 'Skip', 'skip'], ['B', 'Blur', 'blackout']],
};
export const actionKeysFor = (kind) => ACTION_KEYS[kind] || [];
export const WIDEN_STEP = 0.5;

/** Next row after `cursorId` in list order (no wrap); null at the end. `onlyOpen` skips rows with a verdict. */
export function stepFrom(list, cursorId, dir, { onlyOpen = false } = {}) {
  const i = list.findIndex((r) => r.id === cursorId);
  const ok = (r) => r.id !== cursorId && (!onlyOpen || !hasVerdict(r));
  if (dir > 0) { for (let j = i + 1; j < list.length; j++) if (ok(list[j])) return list[j]; return null; }
  if (i < 0) return list.length ? list[list.length - 1] : null;
  for (let j = i - 1; j >= 0; j--) if (ok(list[j])) return list[j];
  return null;
}
