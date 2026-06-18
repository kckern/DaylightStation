// frontend/src/modules/WeeklyReview/state/keymap.js
// Pure remote-input resolver. Given a full snapshot + a key, returns the
// reducer actions and side-effect intents to apply. This module is the
// single source of truth for the input matrix (see the redesign spec).

const EMPTY = () => ({ view: [], modal: [], intents: [], edge: null });
const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

function gridMove(dir, cols, total) {
  return { type: 'GRID_MOVE', dir, cols, total };
}

export function resolveKey(input) {
  const { view, modalType, modalFocus, preflight, key, now, cols, totalDays, media, lastEdge, doubleWindowMs } = input;
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

  // ---- Main hierarchy ----
  if (view.level === 'grid') {
    if (dir) {
      const onTopRow = view.dayIndex < cols;
      if (dir === 'up' && onTopRow) { out.modal.push({ type: 'OPEN', modal: 'exitGate' }); return out; }
      out.view.push(gridMove(dir, cols, totalDays));
      return out;
    }
    if (isEnter) { out.view.push({ type: 'OPEN_DAY' }); return out; }
    if (isBack)  { out.modal.push({ type: 'OPEN', modal: 'exitGate' }); return out; }
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
