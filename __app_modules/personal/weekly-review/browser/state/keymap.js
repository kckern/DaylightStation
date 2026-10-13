// frontend/src/modules/WeeklyReview/state/keymap.js
// Pure remote-input resolver. Given a full snapshot + a key, returns the
// reducer actions and side-effect intents to apply. This module is the
// single source of truth for the input matrix (see the redesign spec).

const EMPTY = () => ({ view: [], modal: [], intents: [], edge: null });
const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

function gridMove(dir, cols, total) {
  return { type: 'GRID_MOVE', dir, cols, total };
}

// True when `lastEdge` is a live arm in this direction — same direction, still
// inside the double-tap window.
function armedCount(lastEdge, dir, now, doubleWindowMs) {
  if (!lastEdge || lastEdge.dir !== dir) return 0;
  if (now - lastEdge.at >= doubleWindowMs) return 0;
  return lastEdge.count || 0;
}

/**
 * Multi-week paging at the grid's vertical edges. Returns a resolved result, or
 * null to let the caller fall through to an ordinary GRID_MOVE.
 *
 * Up:   1 arms · 2 pages back one window · 3 jumps to the oldest window with content
 * Down: 1 arms · 2 pages forward (only when a newer window exists)
 *
 * The third Up is keyed off the armed count rather than the focused row on
 * purpose: the second tap already swapped the window and dropped focus onto the
 * bottom row, so a row test would swallow the third tap.
 */
function resolveGridPaging({ dir, view, cols, totalDays, now, lastEdge, doubleWindowMs, windowNav }) {
  const out = EMPTY();
  const i = view.dayIndex;

  if (dir === 'up') {
    const count = armedCount(lastEdge, 'up', now, doubleWindowMs);
    if (count >= 2) { out.intents.push('jumpOldest'); return out; }
    if (i >= cols) return null; // not on the top row — ordinary move
    if (count === 1) {
      out.intents.push('pageBack');
      out.edge = { dir: 'up', at: now, count: 2 };
      return out;
    }
    out.edge = { dir: 'up', at: now, count: 1 };
    return out;
  }

  if (dir === 'down') {
    // Nothing newer than the current window to page into, so leave Down alone.
    if (!windowNav.hasNewer) return null;
    if (i + cols < totalDays) return null; // not on the bottom row
    if (armedCount(lastEdge, 'down', now, doubleWindowMs) >= 1) {
      out.intents.push('pageForward');
      return out;
    }
    out.edge = { dir: 'down', at: now, count: 1 };
    return out;
  }

  return null;
}

export function resolveKey(input) {
  const { view, modalType, modalFocus, preflight, key, now, cols, totalDays, media, lastEdge, doubleWindowMs } = input;
  const windowNav = input.windowNav || { hasNewer: false };
  const windowLoading = !!input.windowLoading;
  const isEnter = key === 'Enter';
  const isBack = key === 'Escape';
  const dir = ARROWS[key];
  const twoButton = modalType === 'exitGate' || modalType === 'finalizeError' || modalType === 'preflightFailed';
  const out = EMPTY();

  // ---- Modal layer (overrides everything except fall-through cases) ----
  if (modalType === 'disconnect') return out; // informational — swallow all keys

  if (modalType) {
    if (twoButton && (dir === 'left' || dir === 'right' || dir === 'up' || dir === 'down')) {
      out.modal.push({ type: 'TOGGLE_FOCUS' });
      return out;
    }
    if (modalType === 'exitGate') {
      // Second Back confirms exit — "mash Back to get out" must always work.
      // saveAndExit stops the recorder, flushes, finalizes, and always exits.
      if (isBack) { out.modal.push({ type: 'CLOSE' }); out.intents.push('saveAndExit'); return out; }
      if (isEnter) {
        out.modal.push({ type: 'CLOSE' });
        if (modalFocus === 1) out.intents.push('saveAndExit');
        return out;
      }
    }
    if (modalType === 'finalizeError') {
      if (isBack) { out.modal.push({ type: 'CLOSE' }); return out; }
      if (isEnter) { out.modal.push({ type: 'CLOSE' }); if (modalFocus === 1) out.intents.push('exitWidget'); return out; }
    }
    if (modalType === 'preflightFailed') {
      if (isBack) { out.intents.push('exitWidget'); return out; }
      if (isEnter) { out.intents.push(modalFocus === 0 ? 'retryMic' : 'exitWidget'); return out; }
    }
    if (modalType === 'resumeDraft') {
      if (isEnter) { out.modal.push({ type: 'CLOSE' }); out.intents.push('finalizeDraft'); return out; }
      if (isBack) { out.modal.push({ type: 'CLOSE' }); return out; } // defer
      // arrows fall through to the grid underneath
    } else {
      return out; // any unhandled key on a modal is inert
    }
  }

  // ---- Preflight "acquiring": soft gate over the grid ----
  if (preflight === 'acquiring' && isBack) { out.intents.push('exitNoSave'); return out; }

  // ---- Window swap in flight: everything inert except Back ----
  // Back stays live on purpose. A window that loads slowly (or never) must not
  // trap the user inside a live recording session.
  //
  // One further exception: an armed Up escalating to jump-to-oldest. The second
  // tap is what started this load, and the third means "go all the way back" —
  // it must not be swallowed by the very fetch it supersedes.
  if (windowLoading && !isBack) {
    const escalating = view.level === 'grid' && dir === 'up'
      && armedCount(lastEdge, 'up', now, doubleWindowMs) >= 2;
    if (!escalating) return out;
  }

  // ---- Main hierarchy ----
  if (view.level === 'grid') {
    if (dir) {
      // Row edges are where multi-week paging lives. Up past the top row and
      // Down past the bottom row used to be clamped no-ops in the reducer; each
      // is now an arming tap, resolved with the same double-tap counter the reel
      // uses to cross days. A single stray press still moves nothing.
      const paging = resolveGridPaging({ dir, view, cols, totalDays, now, lastEdge, doubleWindowMs, windowNav });
      if (paging) return paging;
      out.view.push(gridMove(dir, cols, totalDays));
      return out;
    }
    if (isEnter) { out.view.push({ type: 'OPEN_DAY' }); return out; }
    // Default focus to "Save & Close" (index 1) so a confirming Enter — or a
    // second Back — exits without having to navigate to the right button.
    if (isBack)  { out.modal.push({ type: 'OPEN', modal: 'exitGate', focusIndex: 1 }); return out; }
    return out;
  }

  // view.level === 'reel'
  if (view.contextOpen) {
    if (dir === 'down' || dir === 'up' || isBack) { out.view.push({ type: 'CLOSE_CONTEXT' }); return out; }
    return out; // left/right/enter inert while panel open
  }

  if (isBack || dir === 'up') { out.view.push({ type: 'CLIMB' }); return out; }
  if (dir === 'down') { out.view.push({ type: 'OPEN_CONTEXT' }); return out; }

  if (isEnter) {
    if (view.playing) { out.view.push({ type: 'TOGGLE_MUTE' }); return out; }
    if (media.currentType === 'video') { out.view.push({ type: 'PLAY_VIDEO' }); return out; }
    if (media.currentType === 'photo') { out.view.push({ type: 'STEP_ITEM', delta: 1, totalItems: media.itemCount }); return out; }
    return out; // empty day
  }

  if (dir === 'left' || dir === 'right') {
    const goingRight = dir === 'right';
    const atEdge = goingRight ? media.atLast : media.atFirst;
    if (!atEdge) {
      out.view.push({ type: 'STEP_ITEM', delta: goingRight ? 1 : -1, totalItems: media.itemCount });
      return out;
    }
    // At the edge: cross day if this is a second tap within the window, else bump + record edge.
    const armed = lastEdge && lastEdge.dir === dir && (now - lastEdge.at) < doubleWindowMs;
    const canCross = goingRight ? media.hasNextDay : media.hasPrevDay;
    if (armed && canCross) {
      const dayIndex = goingRight ? media.nextDayIndex : media.prevDayIndex;
      const itemIndex = goingRight ? 0 : media.prevDayLastIndex;
      out.view.push({ type: 'CROSS_DAY', dayIndex, itemIndex });
      out.edge = null;
      return out;
    }
    out.edge = { dir, at: now };
    return out;
  }

  return out;
}
