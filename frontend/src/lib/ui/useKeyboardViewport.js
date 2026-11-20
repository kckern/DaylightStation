import { useLayoutEffect, useState } from 'react';
import { observeVisualViewport } from './observeVisualViewport.js';

// Track the node because a portal can mount after its owner starts opening.
export function useKeyboardViewport(active) {
  const [surface, setSurface] = useState(null);
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !surface || !viewport) return undefined;
    return fitToKeyboard(surface, viewport);
  }, [active, surface]);
  return setSurface;
}

const keyboardInputTypes = new Set(['text', 'search', 'email', 'password', 'url', 'tel', 'number']);

function canOpenKeyboard(element) {
  if (element?.inputMode === 'none') return false;
  if (element?.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly;
  return element instanceof HTMLInputElement && !element.readOnly && keyboardInputTypes.has(element.type);
}

function fitToKeyboard(surface, viewport) {
  let fitted = false;
  const reset = () => {
    surface.removeAttribute('data-keyboard-viewport');
    surface.style.removeProperty('--keyboard-viewport-top');
    surface.style.removeProperty('--keyboard-viewport-height');
    fitted = false;
  };
  const update = () => {
    const { height, width, offsetTop, scale } = viewport;
    const layout = document.documentElement;
    // A soft keyboard can shrink only the visual viewport. Check for a
    // substantial vertical change at the default scale to exclude pinch zoom
    // and browser toolbar movement.
    const keyboardSized = Math.abs(scale - 1) < 0.01 && Math.abs(width - layout.clientWidth) < 2
      && height > 0 && layout.clientHeight - height >= 100;
    if (!keyboardSized) {
      if (fitted) reset();
      return;
    }
    const field = document.activeElement;
    // Keep the surface steady if a Save tap blurs the field before the keyboard
    // finishes closing.
    if (!fitted && (!surface.contains(field) || !canOpenKeyboard(field))) return;
    surface.style.setProperty('--keyboard-viewport-top', `${Math.max(0, offsetTop)}px`);
    surface.style.setProperty('--keyboard-viewport-height', `${height}px`);
    surface.setAttribute('data-keyboard-viewport', '');
    fitted = true;
  };
  surface.addEventListener('focusin', update);
  const stopObserving = observeVisualViewport(update);
  return () => {
    stopObserving();
    surface.removeEventListener('focusin', update);
    if (fitted) reset();
  };
}
