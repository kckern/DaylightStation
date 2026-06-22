// Pure keyboard mapping for the Art Library. Components call keyToAction() and
// dispatch the returned descriptor; keeping it pure makes the bindings testable
// and trivially re-mappable.

// Numpad compass → CSS object-position keyword. 0 = clear (center default).
const NUMPAD_ANCHOR = {
  7: 'top left', 8: 'top', 9: 'top right',
  4: 'left', 5: 'center', 6: 'right',
  1: 'bottom left', 2: 'bottom', 3: 'bottom right',
  0: null,
};
export function anchorForNumpad(key) {
  if (Object.prototype.hasOwnProperty.call(NUMPAD_ANCHOR, key)) return NUMPAD_ANCHOR[key];
  return undefined;
}

// Was this keydown produced by the numeric keypad (vs the top-row digits)?
const isNumpad = (e) => typeof e.code === 'string' && e.code.startsWith('Numpad');

/**
 * Map a keydown to an action descriptor, or null if unbound.
 * @param {{key:string, code?:string, shiftKey?:boolean}} e
 * @param {{quickTags?:string[], editMode?:boolean}} opts
 */
export function keyToAction(e, { quickTags = [], editMode = false } = {}) {
  const k = e.key;
  // In text-edit mode, suspend all single-key bindings except Escape.
  if (editMode) return k === 'Escape' ? { action: 'exitEdit' } : null;

  // Numpad digits set the crop anchor (checked before top-row digit quick-tags).
  if (isNumpad(e)) {
    const value = anchorForNumpad(k);
    if (value !== undefined) return { action: 'anchor', value };
  }

  switch (k) {
    case 'ArrowRight': case 'j': case 'J': return { action: 'next' };
    case 'ArrowLeft': case 'k': case 'K': return { action: 'prev' };
    case 'Enter': return { action: 'toggleView' };
    case '/': return { action: 'focusSearch' };
    case 'a': case 'A': return { action: 'autoAdvance' };
    case 'u': case 'U': return { action: 'undo' };
    case 't': case 'T': return { action: 'palette' };
    case 'x': case 'X': return { action: 'toggleHidden' };
    case 'f': case 'F': return { action: 'toggleFlagged' };
    case 'e': case 'E': return { action: 'edit' };
    case 'Backspace': case '-': return { action: 'removeFromCollection' };
    default: break;
  }

  // Top-row digits 1..9 → quick-tag at that index (if configured).
  if (/^[1-9]$/.test(k)) {
    const tag = quickTags[Number(k) - 1];
    return tag ? { action: 'toggleTag', tag } : null;
  }
  return null;
}

export default { keyToAction, anchorForNumpad };
