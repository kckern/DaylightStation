import { useEffect, useLayoutEffect, useRef } from 'react';
import { Button } from '@mantine/core';
import { CHROME_SCROLL_CLASS, ToastRegion, Toast } from '@/lib/ui';
import { PortionDraftAlert } from "./PortionDraftAlert.jsx";
import { CaptureDayActions, useMoveInFlight } from "./MoveDayControl.jsx";

// Pure information ("Moved to Lunch", "copied to today") retires on its own.
// Anything carrying an action stays until it is used or dismissed.
export const INFO_TOAST_MS = 6000;
// A capture can answer with the model's own paragraph. Past this length it is
// something to read, not a glance, so it stays until dismissed.
export const INFO_TOAST_MAX_CHARS = 80;
const REGION_LABEL = 'Food log notifications';
const REGION = `[aria-label="${REGION_LABEL}"]`;
const CLEARANCE = '--health-toast-clearance';
const CLEARANCE_GAP_PX = 8;
// The next thing to do in a toast, for focus that lost its control.
const NEXT_ACTION = { 'data-after-focus-loss': true };
const infoAutoClose = text => (typeof text === 'string' && text.length <= INFO_TOAST_MAX_CHARS ? INFO_TOAST_MS : null);

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

// The row that wraps on a phone and gives every action a finger-sized target.
const Actions = ({ children }) => <span className="health-capture-actions">{children}</span>;

const enabledIn = (root, selector) => [...(root?.querySelectorAll(selector) || [])].filter(node => !node.disabled);
/** Where focus goes after its control left: its toast, another toast, then the day bar. */
function focusSuccessor(toast) {
  const region = document.querySelector(REGION);
  const live = toast?.isConnected ? toast : null;
  return enabledIn(live, '[data-after-focus-loss]').at(-1) || enabledIn(live, 'button')[0]
    || enabledIn(region, '[data-after-focus-loss]').at(-1) || enabledIn(region, 'button')[0]
    || document.querySelector('.health-day-input__move') || document.querySelector('.health-day-input input');
}
/**
 * A toast action often removes itself: a move replaces its button, an Undo ends its
 * toast. Focus left there would fall to the page, so it moves to what comes next. A
 * button only busy with its own request keeps its place, and focus the person has
 * taken elsewhere is left alone. A busy button that comes back gets its focus back.
 */
function useToastFocusRecovery() {
  const focused = useRef(null); // { control, toast }
  useEffect(() => {
    const onFocus = event => {
      const inRegion = event.target?.closest?.(REGION);
      focused.current = inRegion ? { control: event.target, toast: event.target.closest('.ds-toast') } : null;
    };
    const onPress = event => { if (!event.target?.closest?.(REGION)) focused.current = null; };
    document.addEventListener('focusin', onFocus);
    document.addEventListener('pointerdown', onPress, true);
    return () => { document.removeEventListener('focusin', onFocus); document.removeEventListener('pointerdown', onPress, true); };
  }, []);
  useLayoutEffect(() => {
    if (!focused.current) return;
    const { control, toast } = focused.current;
    const active = document.activeElement;
    const lost = !active || active === document.body;
    if (control.isConnected && control.disabled && control.hasAttribute('data-loading')) { focused.current.busy = true; return; }
    if (control.isConnected && !control.disabled) {
      // The browser can drop focus from a busy button, which is back if its retry failed.
      if (focused.current.busy && lost) control.focus({ preventScroll: true });
      focused.current.busy = false;
      return;
    }
    if (!lost && active !== control) return;
    focused.current = null;
    focusSuccessor(toast)?.focus({ preventScroll: true });
  });
}
/**
 * A move picked from a menu outside the toasts: the menu is closing, and a meal's
 * menu button leaves with the meal's foods. Each time `settled` changes, focus with
 * nowhere to be goes to what the move left to do. The picked item counts as nowhere,
 * since it may still be fading out.
 */
function useMenuMoveFocus(settled) {
  useLayoutEffect(() => {
    if (!settled) return;
    const active = document.activeElement;
    if (!active || active === document.body || active.closest?.('[data-menu-item]')) focusSuccessor(null)?.focus({ preventScroll: true });
  }, [settled]);
}
/**
 * The day sheet closed on a move it could still retry, and that retry is now on a
 * toast. Focus went to the day bar when the sheet closed, and goes on from there as
 * soon as the button can be pressed, unless the person has taken it elsewhere.
 */
function useHandedBackMoveFocus(moveId) {
  const settled = useRef(null);
  useLayoutEffect(() => {
    if (!moveId || settled.current === moveId) return;
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest?.('.health-day-input__move')) { settled.current = moveId; return; }
    const retry = document.querySelector(`${REGION} [data-move-retry="${moveId}"]:not(:disabled)`);
    if (!retry) return;
    settled.current = moveId;
    retry.focus({ preventScroll: true });
  });
}
/**
 * Toasts float over the end of the day, so the page gets that much more room to
 * scroll. The room is added below everything, so nothing on screen moves when a
 * toast arrives. Room the view is standing in is kept until it scrolls away, so a
 * toast leaving does not pull the page either.
 */
function useToastClearance() {
  const watching = useRef(null);
  const update = useRef(() => {});
  update.current = () => {
    const parts = watching.current;
    if (!parts) return;
    const { region, page, scroller } = parts;
    const current = parseFloat(page.style.getPropertyValue(CLEARANCE)) || 0;
    const needed = region.childElementCount
      ? Math.max(0, Math.ceil(scroller.getBoundingClientRect().bottom - region.getBoundingClientRect().top + CLEARANCE_GAP_PX)) : 0;
    const spare = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    const next = Math.max(needed, Math.ceil(current - spare));
    if (next !== current) page.style.setProperty(CLEARANCE, `${next}px`);
  };
  // The region arrives a render after this view, so each render looks for it.
  useEffect(() => {
    if (!watching.current) {
      const region = document.querySelector(REGION);
      const page = document.querySelector('.health-today');
      const scroller = page?.closest(`.${CHROME_SCROLL_CLASS}`);
      if (region && page && scroller) {
        const onChange = () => update.current();
        scroller.addEventListener('scroll', onChange, { passive: true });
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onChange);
        observer?.observe(region);
        watching.current = { region, page, scroller, stop: () => { observer?.disconnect(); scroller.removeEventListener('scroll', onChange); } };
      }
    }
    update.current();
  });
  useEffect(() => () => {
    watching.current?.stop();
    watching.current?.page.style.removeProperty(CLEARANCE);
    watching.current = null;
  }, []);
}

/**
 * A meal change and its Undo. A fresh capture also carries `offer`: the fix for
 * food that landed on the wrong day. One action runs at a time, because a move
 * retires the capture's Undo and an Undo removes the foods being moved. Food
 * added without a server Undo (`token` null), or whose Undo a newer action
 * retired, gets the day fix alone.
 */
function MealUndoToast({ mealUndo, today, onMoveCapture, onUndoMeal, onDismissMealUndo, undoBusy, named = false }) {
  const [moving, run] = useMoveInFlight(action => action());
  const food = named ? mealUndo.offer?.what || 'food' : null;
  // A failed move or Undo is told here, on the toast that offered it.
  return <Toast message={mealUndo.moveFailure || mealUndo.failure || mealUndo.label}>
    <span className="health-capture-actions">
      {/* An unknown outcome holds the food: the only safe next step is the same move again. */}
      {mealUndo.retryMove ? <Button {...NEXT_ACTION} size="compact-xs" variant="light" loading={moving} disabled={undoBusy}
        aria-label={`Retry moving ${mealUndo.offer.what || 'food'}`} onClick={() => run(mealUndo.retryMove)}>Try again</Button>
        : mealUndo.offer ? <CaptureDayActions date={mealUndo.offer.date} today={today} onMove={iso => run(() => onMoveCapture(iso))}
          busy={moving} disabled={undoBusy} food={food} /> : null}
      {mealUndo.token ? <Button {...(mealUndo.retryMove ? {} : NEXT_ACTION)} size="compact-xs" aria-label="Undo meal change" loading={undoBusy} disabled={moving} onClick={onUndoMeal}>Undo</Button> : null}
      <Button size="compact-xs" variant="subtle" disabled={undoBusy || moving} aria-label={food ? `Dismiss ${food}` : undefined} onClick={onDismissMealUndo}>Dismiss</Button>
    </span>
  </Toast>;
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
  strandedPortion, today, onMoveCapture, onSupersedeMealUndo, dayOffers = [], onMoveOffer, onDismissOffer,
  dayNotice = null, onDismissDayNotice, unresolvedMoves = [], menuMoveSettled = 0, handedBackMove = null,
}) {
  useToastFocusRecovery();
  useMenuMoveFocus(menuMoveSettled);
  useHandedBackMoveFocus(handedBackMove);
  useToastClearance();
  const newestUndo = useNewestUndo([
    moves.undo && { key: `move:${moves.undo.label}`, clear: moves.undo.dismiss },
    // A newer action retires the Undo. What else the toast offers is the view's to keep.
    mealUndo && { key: `meal:${mealUndo.token}`, clear: onSupersedeMealUndo ?? onDismissMealUndo },
    undoDelete && { key: `delete:${(undoDelete.entryIds || []).join(',')}`, clear: onDismissUndoDelete },
  ].filter(Boolean));
  const kind = newestUndo?.key.split(':')[0];
  const named = dayOffers.length + (kind === 'meal' && mealUndo.offer ? 1 : 0) > 1;

  // One at a time, newest first: each holds its foods until it is settled.
  const unresolved = unresolvedMoves.at(-1);
  const waitingMoves = unresolvedMoves.length - 1;

  return <ToastRegion label={REGION_LABEL}>
    {strandedPortion ? <Toast tone="error" message={<PortionDraftAlert control={strandedPortion} role={null} className="health-portion-error" />} /> : null}
    {moves.error && !moves.errorHandled ? <Toast tone="error" message={moves.error}>
      <Actions><Button size="compact-xs" variant="subtle" onClick={moves.clearError}>Dismiss</Button></Actions>
    </Toast> : null}
    {unresolved ? <Toast tone="error" message={waitingMoves ? `${unresolved.message} ${waitingMoves} more waiting.` : unresolved.message}>
      <Actions>
        <Button {...NEXT_ACTION} data-move-retry={unresolved.id} size="compact-xs" variant="light" loading={unresolved.busy} onClick={unresolved.retry}>Try again</Button>
        {unresolved.dismiss ? <Button size="compact-xs" variant="subtle" disabled={unresolved.busy} onClick={unresolved.dismiss}>Dismiss</Button> : null}
      </Actions>
    </Toast> : null}
    {orphanRetry ? <Toast tone={orphanRetry.error ? 'error' : 'info'}
      message={`Your ${orphanRetry.label} didn't send.${orphanRetry.error ? ` ${orphanRetry.error}` : ''}`}>
      <Actions>
        <Button {...NEXT_ACTION} size="compact-xs" loading={orphanRetry.busy} onClick={onRetryOrphan}>Retry recording</Button>
        <Button size="compact-xs" variant="subtle" disabled={orphanRetry.busy} onClick={onDismissOrphan}>Dismiss</Button>
      </Actions>
    </Toast> : null}
    {captureNotice ? <Toast message={captureNotice} autoCloseMs={captureRetry ? null : infoAutoClose(captureNotice)} onAutoClose={onDismissCapture}>
      <Actions>
        {captureRetry ? <Button {...NEXT_ACTION} size="compact-xs" loading={retryBusy} disabled={retryBusy} onClick={onRetryCapture}>Try again</Button> : null}
        <Button size="compact-xs" variant="subtle" onClick={onDismissCapture}>Dismiss</Button>
      </Actions>
    </Toast> : null}
    {/* Separate from the capture notice, which may be holding a recording's retry. */}
    {dayNotice ? <Toast message={dayNotice} autoCloseMs={infoAutoClose(dayNotice)} onAutoClose={onDismissDayNotice}>
      <Actions><Button size="compact-xs" variant="subtle" onClick={onDismissDayNotice}>Dismiss</Button></Actions>
    </Toast> : null}
    {kind === 'move' ? <Toast message={moves.undo.failure || moves.undo.label}>
      <Actions>
        <Button {...NEXT_ACTION} size="compact-xs" aria-label="Undo move" onClick={moves.undo.run}>Undo</Button>
        <Button size="compact-xs" variant="subtle" onClick={moves.undo.dismiss}>Dismiss</Button>
      </Actions>
    </Toast> : null}
    {kind === 'meal' ? <MealUndoToast key={mealUndo.token} mealUndo={mealUndo} today={today} onMoveCapture={onMoveCapture}
      onUndoMeal={onUndoMeal} onDismissMealUndo={onDismissMealUndo} undoBusy={undoBusy} named={named} /> : null}
    {dayOffers.map(shown => <MealUndoToast key={shown.offer.ids.join(',') || shown.offer.logId} mealUndo={shown} today={today} named={named}
      onMoveCapture={iso => onMoveOffer(shown, iso)} onDismissMealUndo={() => onDismissOffer(shown)} undoBusy={false} />)}
    {kind === 'delete' ? <Toast message={`${undoDelete.label} deleted.`}>
      <Actions>
        <Button {...NEXT_ACTION} size="compact-xs" loading={undoBusy} onClick={onUndoDelete}>Undo</Button>
        <Button size="compact-xs" variant="subtle" disabled={undoBusy} onClick={onDismissUndoDelete}>Dismiss</Button>
      </Actions>
    </Toast> : null}
  </ToastRegion>;
}

export default TodayToasts;
