// frontend/src/modules/WeeklyReview/state/viewReducer.js
export const initialViewState = {
  level: 'grid',     // 'grid' | 'reel'
  dayIndex: 0,
  itemIndex: 0,
  playing: false,
  muted: true,
  contextOpen: false,
};

function clamp(n, min, max) {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

// Reset reel-local fields when leaving the reel or changing item/day.
const REEL_RESET = { itemIndex: 0, playing: false, muted: true, contextOpen: false };

export function viewReducer(state, action) {
  switch (action.type) {
    case 'SELECT_DAY':
      return { ...state, dayIndex: action.dayIndex };

    case 'GRID_MOVE': {
      const { dir, cols, total } = action;
      const i = state.dayIndex;
      let next = i;
      if (dir === 'left'  && i % cols !== 0)        next = i - 1;
      if (dir === 'right' && i % cols !== cols - 1) next = i + 1;
      if (dir === 'up'    && i - cols >= 0)         next = i - cols;
      if (dir === 'down'  && i + cols < total)      next = i + cols;
      if (next < 0 || next >= total) next = i; // never land off-grid
      return { ...state, dayIndex: next };
    }

    case 'OPEN_DAY':
      return { ...state, level: 'reel', ...REEL_RESET };

    case 'CROSS_DAY':
      return { ...state, level: 'reel', dayIndex: action.dayIndex, itemIndex: action.itemIndex, playing: false, muted: true, contextOpen: false };

    case 'STEP_ITEM': {
      const next = clamp(state.itemIndex + action.delta, 0, Math.max(0, action.totalItems - 1));
      return { ...state, itemIndex: next, playing: false, muted: true };
    }

    case 'CLIMB': {
      if (state.contextOpen) return { ...state, contextOpen: false };
      if (state.playing)     return { ...state, playing: false, muted: true };
      if (state.level === 'reel') return { ...initialViewState, dayIndex: state.dayIndex };
      return state; // grid: no-op; caller opens the exit gate
    }

    case 'OPEN_CONTEXT':  return { ...state, contextOpen: true };
    case 'CLOSE_CONTEXT': return { ...state, contextOpen: false };
    case 'PLAY_VIDEO':    return { ...state, playing: true, muted: true };
    case 'TOGGLE_MUTE':   return { ...state, muted: !state.muted };
    case 'STOP_VIDEO':    return { ...state, playing: false };

    default: return state;
  }
}
