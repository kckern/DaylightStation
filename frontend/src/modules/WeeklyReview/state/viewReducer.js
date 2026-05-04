export const initialViewState = {
  level: 'toc',       // 'toc' | 'day' | 'fullscreen'
  dayIndex: 0,
  imageIndex: 0,
  focusRow: 'main',   // 'main' | 'bar'
};

export function makeInitialView(totalDays) {
  if (!totalDays || totalDays <= 0) return initialViewState;
  return { ...initialViewState, dayIndex: totalDays - 1 };
}

function clamp(n, min, max) {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function viewReducer(state, action) {
  switch (action.type) {
    case 'SELECT_DAY': {
      const totalDays = action.totalDays ?? Infinity;
      const dayIndex = clamp(action.index, 0, Math.max(0, totalDays - 1));
      return { ...state, dayIndex };
    }
    case 'OPEN_DAY': {
      const dayIndex = action.index !== undefined
        ? clamp(action.index, 0, Math.max(0, (action.totalDays ?? Infinity) - 1))
        : state.dayIndex;
      return { ...state, level: 'day', dayIndex, imageIndex: 0, focusRow: 'main' };
    }
    case 'OPEN_PHOTO':
      return { ...state, level: 'fullscreen', imageIndex: action.index ?? 0 };
    case 'CYCLE_PHOTO': {
      if (!action.totalPhotos || action.totalPhotos <= 0) return state;
      const next = (state.imageIndex + action.delta + action.totalPhotos) % action.totalPhotos;
      return { ...state, imageIndex: next };
    }
    case 'CYCLE_DAY': {
      const totalDays = action.totalDays ?? Infinity;
      const next = clamp(state.dayIndex + action.delta, 0, Math.max(0, totalDays - 1));
      return { ...state, dayIndex: next, imageIndex: 0 };
    }
    case 'BACK': {
      if (state.focusRow === 'bar') return { ...state, focusRow: 'main' };
      if (state.level === 'fullscreen') return { ...state, level: 'day' };
      if (state.level === 'day') return { ...state, level: 'toc' };
      return state;
    }
    case 'FOCUS_BAR':
      return { ...state, focusRow: 'bar' };
    case 'FOCUS_MAIN':
      return { ...state, focusRow: 'main' };
    default:
      return state;
  }
}
