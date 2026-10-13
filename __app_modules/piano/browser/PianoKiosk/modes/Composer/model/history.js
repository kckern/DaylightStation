// history.js — undo/redo snapshot ring for the Composer EditorState (Unit 8, B24).
//
// Design: the editor commands in editor.js stay PURE and history-agnostic. This
// module layers undo/redo on top by snapshotting whole `score` objects.
//
//   - `applyCommand(state, fn, ...args)` runs a command and, IF it changed the
//     score, records the PRIOR score onto `history.past` and clears `future`.
//     Caret/selection moves reuse the same score object reference, so they are
//     detected (`next.score === state.score`) and DON'T push history.
//   - `withHistory(fn)` is a thin HOF wrapper producing a history-recording
//     version of a command (e.g. `const insertNoteH = withHistory(insertNote)`),
//     for callers that prefer bound commands over `applyCommand`.
//
// EditorState carries `history: { past: [], future: [] }` (seeded by initEditor).
// `past` is capped at HISTORY_CAP (oldest dropped).
//
// Cost note (accepted v1 tradeoff): each mutating command deep-clones the whole
// score (structuredClone in editor.js) and we retain up to HISTORY_CAP=200 whole
// snapshots. Kid-scale scores are small, so this is fine for v1.
// TODO: structural sharing / patch-based history if scores grow.

export const HISTORY_CAP = 200;

function pastOf(state) {
  return state.history?.past ?? [];
}
function futureOf(state) {
  return state.history?.future ?? [];
}

/**
 * Record `prevState.score` onto the past of `nextState` (clearing future).
 * Returns nextState with an updated, capped history.
 */
export function pushHistory(prevState, nextState) {
  const past = [...pastOf(prevState), prevState.score].slice(-HISTORY_CAP);
  return { ...nextState, history: { past, future: [] } };
}

/**
 * Run a command, recording history only when the score actually changed.
 * @param {object} state
 * @param {(state:object, ...args:any[]) => object} fn
 */
export function applyCommand(state, fn, ...args) {
  const next = fn(state, ...args);
  if (next.score === state.score) return next; // non-mutating (e.g. caret move)
  return pushHistory(state, next);
}

/** Wrap a command into a history-recording version. */
export function withHistory(fn) {
  return (state, ...args) => applyCommand(state, fn, ...args);
}

/** Restore the previous score snapshot; push the current score onto future. */
export function undo(state) {
  const past = pastOf(state);
  if (past.length === 0) return state;
  const prevScore = past[past.length - 1];
  return {
    ...state,
    score: prevScore,
    history: { past: past.slice(0, -1), future: [state.score, ...futureOf(state)] },
    dirty: true,
    revision: state.revision + 1,
  };
}

/** Re-apply the next score snapshot; push the current score back onto past. */
export function redo(state) {
  const future = futureOf(state);
  if (future.length === 0) return state;
  const nextScore = future[0];
  return {
    ...state,
    score: nextScore,
    history: {
      past: [...pastOf(state), state.score].slice(-HISTORY_CAP),
      future: future.slice(1),
    },
    dirty: true,
    revision: state.revision + 1,
  };
}
