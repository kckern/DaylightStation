/**
 * Pure rules of the review station: what a row's action is, which rows a scope (show x kind x action x
 * needs-review x group) keeps, which keys apply to a kind, and where the cursor steps next.
 * One scope drives the list, the timeline and cursor stepping.
 */
export const KIND_SCOPES = [{ label: 'All', value: 'all' }, { label: 'Words', value: 'words' }, { label: 'Picture', value: 'picture' }, { label: 'Scenes', value: 'scenes' }];
export const ACTION_SCOPES = [{ label: 'All actions', value: 'all' }, { label: 'Blur', value: 'blur' }, { label: 'Skip', value: 'skip' }, { label: 'Bleep', value: 'bleep' }, { label: 'Mute', value: 'mute' }];
/** Timing: every part, the ones still on VidAngel's rough times, or the measured ones (incl. safe windows). */
export const TIMING_SCOPES = [{ label: 'Any timing', value: 'all' }, { label: 'Rough timing', value: 'rough' }, { label: 'Refined timing', value: 'refined' }];
/** Order: through the film from the start (default), or the parts that need a look first. */
export const ORDER_SCOPES = [{ label: 'Film order', value: 'film' }, { label: 'Needs a look first', value: 'attention' }];
// The filtered parts are the review (owner, 2026-11-21); the ones that play are browsed on their own tab.
// `stage` is the rail tab in hand (ReviewRail.jsx): refine | review | approve | plays. It sets `show`,
// and Refine narrows the filtered parts to the ones refine still has to pin (or is working on).
export const STAGE_TABS = ['refine', 'review', 'approve', 'plays'];
export const DEFAULT_SCOPE = Object.freeze({ stage: 'review', show: 'filtered', kind: 'all', action: 'all', needs: false, group: null, timing: 'all', order: 'film' });
/** A part the household's settings let play (audits before 2026-11-21 had none). */
export const plays = (row) => row?.acts === false;

const ACTION_OF = { mute: 'mute', bleep: 'bleep', blur: 'blur', 'full-blur': 'blur', blackout: 'blur', skip: 'skip', 'skip-card': 'skip' };
/** The effect button a part's effect lights: full blur is Blur, a skip behind a card is Skip. */
const BUTTON_OF = { 'full-blur': 'blur', pixelate: 'blur', 'censor-bar': 'blur', 'skip-card': 'skip' };
export const effectButton = (effect) => BUTTON_OF[effect] || effect || null;
/** blur | skip | bleep | mute, or null (off / use settings). */
export const rowAction = (row) => ACTION_OF[row?.effect] || null;

/** A row has a verdict when the server says so (a moved span already cleared it there). */
export const hasVerdict = (row) => Boolean(row?.verdict || row?.reviewed);
/**
 * Still waiting for a verdict: a filtered part without one. A part that plays needs none, unless the
 * view is the playing parts (then stepping through them is the point).
 */
export const isOpen = (row, scope = DEFAULT_SCOPE) => !hasVerdict(row) && (!plays(row) || scope?.show === 'plays');

/** Refine already tried this part and left a reason (not found, coarse edges, …): refining again will not pin it. */
export const triedRefine = (row) => (row?.unsure || []).some((u) => String(u).startsWith('refine-'));
/**
 * A filtered part whose timing refine could not vouch for, that nobody has looked at yet: it is
 * checked by ear or eye. A verdict or a hand fix is that look (owner, 2026-11-22: "Done" hid these).
 */
export const needsCheck = (row) => !plays(row) && triedRefine(row) && !row.handFixed && !hasVerdict(row);

/** The scope a rail tab stands for: the same filters, on that tab's parts. */
export const stageScope = (scope, stage) => ({ ...(scope || DEFAULT_SCOPE), stage, show: stage === 'plays' ? 'plays' : 'filtered' });
/** A part the Refine tab lists: on rough timing (tried or not; a true scene is rebuilt, not refined), one refine left unsure, or in a refine right now. */
const inRefine = (row, refining) => Boolean(refining?.[row.id]) || ((row.timing === 'rough' || triedRefine(row)) && !isSceneRow(row));

export function inScope(row, scope = DEFAULT_SCOPE, { refining = null } = {}) {
  const show = scope.show || 'all';
  return (show === 'all' || (show === 'plays' ? plays(row) : !plays(row)))
    && (scope.kind === 'all' || row.kind === scope.kind)
    && (scope.action === 'all' || rowAction(row) === scope.action)
    && (!scope.group || row.group === scope.group)
    && (!scope.timing || scope.timing === 'all' || (scope.timing === 'rough' ? row.timing === 'rough' : row.timing === 'refined' || row.timing === 'safe-window'))
    && (scope.stage !== 'refine' || inRefine(row, refining))
    && (!scope.needs || scope.stage === 'refine' || isOpen(row, scope));
}
/** The rows a scope keeps, in its order: film order (default) or as the audit ranks them (unsure first). */
export function scopeRows(rows, scope, opts) {
  const kept = (rows || []).filter((r) => inScope(r, scope, opts));
  return (scope?.order || 'film') === 'film' ? [...kept].sort((a, b) => a.in - b.in || a.out - b.out) : kept;
}

/** F cycles the kind scope. */
export function nextKind(kind) {
  const order = KIND_SCOPES.map((k) => k.value);
  return order[(order.indexOf(kind) + 1) % order.length];
}

/** Contextual action keys for a kind: [key, label, effect value to apply]. Widen applies to every kind. */
const ACTION_KEYS = {
  // F = filter off; O is the out point (owner, 2026-11-22: I and O for in and out).
  words: [['M', 'Mute', 'mute'], ['P', 'Bleep', 'bleep'], ['K', 'Skip', 'skip'], ['F', 'Off', 'off']],
  picture: [['B', 'Blur', 'blur'], ['H', 'Hide picture', 'blackout'], ['K', 'Skip', 'skip'], ['F', 'Off', 'off']],
  scenes: [['K', 'Skip', 'skip'], ['B', 'Hide picture', 'blackout'], ['F', 'Off', 'off']],
};
export const actionKeysFor = (kind) => ACTION_KEYS[kind] || [];
/** A true scene row (built from a refined EDL's scenes): no member cues of its own. A word skipped as an exchange is listed with scenes but is a cue. */
export const isSceneRow = (row) => row?.kind === 'scenes' && !(row.members || []).length && !String(row.id || '').startsWith('cue:');
/** Which effect keys a part takes: by its channel (said / shown), a true scene by its own. */
export const keysKindOf = (row) => (isSceneRow(row) ? 'scenes' : row?.modality === 'said' || row?.modality === 'heard' ? 'words' : row?.modality === 'shown' ? 'picture' : row?.kind);
export const WIDEN_STEP = 0.5;

/** Next row after `cursorId` in list order (no wrap); null at the end. `onlyOpen` skips rows with a verdict. */
export function stepFrom(list, cursorId, dir, { onlyOpen = false, scope = DEFAULT_SCOPE } = {}) {
  const i = list.findIndex((r) => r.id === cursorId);
  const ok = (r) => r.id !== cursorId && (!onlyOpen || isOpen(r, scope));
  if (dir > 0) { for (let j = i + 1; j < list.length; j++) if (ok(list[j])) return list[j]; return null; }
  if (i < 0) return list.length ? list[list.length - 1] : null;
  for (let j = i - 1; j >= 0; j--) if (ok(list[j])) return list[j];
  return null;
}
