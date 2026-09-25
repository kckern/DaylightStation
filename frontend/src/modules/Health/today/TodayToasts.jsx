import { useEffect, useRef } from 'react';
import { Button } from '@mantine/core';
import { ToastRegion, Toast } from '@/lib/ui';
import { PortionDraftAlert } from './PortionDraftAlert.jsx';

// Pure information ("Moved to Lunch", "copied to today") retires on its own.
// Anything carrying an action stays until it is used or dismissed.
export const INFO_TOAST_MS = 6000;

/**
 * Only the newest undo is offered. Three things can each hold one (a meal
 * move, an AI meal change, a delete); left alone they piled up, and an older
 * "Undo" beside a newer one invites undoing the wrong thing. An undo is
 * superseded by the next undoable action, never by a timer — see Toast.
 */
function useNewestUndo(candidates) {
  const seen = useRef(new Map());
  const seq = useRef(0);
  const present = new Set(candidates.map(c => c.key));
  for (const key of [...seen.current.keys()]) if (!present.has(key)) seen.current.delete(key);
  for (const c of candidates) if (!seen.current.has(c.key)) seen.current.set(c.key, ++seq.current);
  const newest = candidates.reduce((a, b) => (!a || seen.current.get(b.key) > seen.current.get(a.key) ? b : a), null);
  const stale = candidates.filter(c => c !== newest);
  const staleKey = stale.map(c => c.key).join('|');
  const staleRef = useRef(stale);
  staleRef.current = stale;
  useEffect(() => { staleRef.current.forEach(c => c.clear()); }, [staleKey]);
  return newest;
}

/**
 * The Today view's post-action feedback, floating under the header instead of
 * stacked above the meals (where each arrival pushed the whole day down). The
 * view still owns every piece of state; this only decides how it is shown.
 */
export function TodayToasts({
  captureNotice, captureRetry, retryBusy, onRetryCapture, onDismissCapture,
  orphanRetry, onRetryOrphan, onDismissOrphan,
  moves, mealUndo, onUndoMeal, onDismissMealUndo, undoDelete, onUndoDelete, onDismissUndoDelete, undoBusy,
  strandedPortion,
}) {
  const newestUndo = useNewestUndo([
    moves.undo && { key: `move:${moves.undo.label}`, clear: moves.undo.dismiss },
    mealUndo && { key: `meal:${mealUndo.token}`, clear: onDismissMealUndo },
    undoDelete && { key: `delete:${(undoDelete.entryIds || []).join(',')}`, clear: onDismissUndoDelete },
  ].filter(Boolean));
  const kind = newestUndo?.key.split(':')[0];

  return <ToastRegion label="Food log notifications">
    {strandedPortion ? <Toast tone="error" message={<PortionDraftAlert control={strandedPortion} className="health-portion-error" />} /> : null}
    {moves.error ? <Toast tone="error" message={moves.error}>
      <Button size="compact-xs" variant="subtle" onClick={moves.clearError}>Dismiss</Button>
    </Toast> : null}
    {orphanRetry ? <Toast tone={orphanRetry.error ? 'error' : 'info'}
      message={`Your ${orphanRetry.label} didn't send.${orphanRetry.error ? ` ${orphanRetry.error}` : ''}`}>
      <Button size="compact-xs" loading={orphanRetry.busy} onClick={onRetryOrphan}>Retry recording</Button>
      <Button size="compact-xs" variant="subtle" disabled={orphanRetry.busy} onClick={onDismissOrphan}>Dismiss</Button>
    </Toast> : null}
    {captureNotice ? <Toast message={captureNotice} autoCloseMs={captureRetry ? null : INFO_TOAST_MS} onAutoClose={onDismissCapture}>
      {captureRetry ? <Button size="compact-xs" loading={retryBusy} disabled={retryBusy} onClick={onRetryCapture}>Try again</Button> : null}
      <Button size="compact-xs" variant="subtle" onClick={onDismissCapture}>Dismiss</Button>
    </Toast> : null}
    {kind === 'move' ? <Toast message={moves.undo.label}>
      <Button size="compact-xs" aria-label="Undo move" onClick={moves.undo.run}>Undo</Button>
      <Button size="compact-xs" variant="subtle" onClick={moves.undo.dismiss}>Dismiss</Button>
    </Toast> : null}
    {kind === 'meal' ? <Toast message={mealUndo.label}>
      <Button size="compact-xs" aria-label="Undo meal change" loading={undoBusy} onClick={onUndoMeal}>Undo</Button>
      <Button size="compact-xs" variant="subtle" disabled={undoBusy} onClick={onDismissMealUndo}>Dismiss</Button>
    </Toast> : null}
    {kind === 'delete' ? <Toast message={`${undoDelete.label} deleted.`}>
      <Button size="compact-xs" loading={undoBusy} onClick={onUndoDelete}>Undo</Button>
      <Button size="compact-xs" variant="subtle" disabled={undoBusy} onClick={onDismissUndoDelete}>Dismiss</Button>
    </Toast> : null}
  </ToastRegion>;
}

export default TodayToasts;
