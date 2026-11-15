// Keep touch compatibility mouse events from invoking a press a second time.
const touchPresses = new WeakSet();
const invoke = (action, event) => {
  if (event.currentTarget.disabled) return;
  event.currentTarget.focus?.({ preventScroll: true });
  action?.(event);
};

/** Act on down for mouse/touch/pen, with native keyboard/assistive click fallback. */
export function pressDown(action) {
  return {
    onMouseDown(event) {
      if (event.button !== 0 || touchPresses.has(event.currentTarget)) return;
      invoke(action, event);
    },
    onPointerDown(event) {
      if (event.pointerType === 'mouse') { touchPresses.delete(event.currentTarget); return; }
      if (!event.pointerType || event.isPrimary === false) return;
      touchPresses.add(event.currentTarget);
      invoke(action, event);
    },
    onPointerCancel(event) { touchPresses.delete(event.currentTarget); },
    onKeyDown(event) {
      if (event.key !== 'Enter' && event.key !== 'NumpadEnter' && event.key !== ' ') return;
      // The resting keypad also owns Enter globally; a focused control wins.
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) { touchPresses.delete(event.currentTarget); invoke(action, event); }
    },
    onClick(event) { touchPresses.delete(event.currentTarget); if (event.detail === 0) invoke(action, event); },
  };
}
