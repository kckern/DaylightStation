import { useEffect, useLayoutEffect, useRef } from 'react';
import { ActionIcon, FocusTrap } from '@mantine/core';
import { useAppMainRef, useViewOverlaysActive } from './AppFrame.jsx';
import { useDismissLayer } from './dismiss/useDismissLayer.js';
import { useOverlayFocusReturn } from './dismiss/useOverlayFocusReturn.js';
import { UiIcon } from './UiIcon.jsx';
import { observeVisualViewport } from './observeVisualViewport.js';
import './ds.scss';

/**
 * The house overlay: bottom sheet on mobile; on desktop a centered dialog by
 * default, or — `placement="side"` — a full-height panel on the right edge, for
 * a drill-in that sits beside the page it came from (CSS). Registers on the dismiss stack (Escape), closes on scrim click, locks
 * body scroll while open.
 */
export function Sheet({ open, onClose, title, children, placement = 'center', returnFocusRef }) {
  const sheetRef = useRef(null);
  const mainRef = useAppMainRef();
  const overlaysActive = useViewOverlaysActive();
  const visible = open && overlaysActive;
  useDismissLayer(open, onClose, { isActive: () => visible });
  useOverlayFocusReturn(open, returnFocusRef);

  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    if (!visible || !viewport) return undefined;
    return fitSheetToKeyboard(sheetRef.current, viewport);
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    const unlockBody = lockScroll(document.body);
    const main = mainRef?.current;
    const unlockMain = main ? lockScroll(main) : null;
    return () => {
      unlockMain?.();
      unlockBody();
    };
  }, [mainRef, visible]);

  if (!open) return null;
  return (
    <div ref={sheetRef} className={placement === 'side' ? 'ds-sheet ds-sheet--side' : 'ds-sheet'} hidden={!visible} role="dialog" aria-modal={visible || undefined} aria-label={title}>
      <div className="ds-sheet__scrim" onClick={onClose} />
      <FocusTrap active={visible}><div className="ds-sheet__panel" tabIndex={-1}>
        <header className="ds-sheet__header">
          <h3 className="ds-sheet__title">{title}</h3>
          <ActionIcon className="ds-touch-target" onClick={onClose} aria-label="Close">
            <UiIcon name="close" />
          </ActionIcon>
        </header>
        <div className="ds-sheet__body">{children}</div>
      </div></FocusTrap>
    </div>
  );
}

const keyboardInputTypes = new Set(['text', 'search', 'email', 'password', 'url', 'tel', 'number']);

function canOpenKeyboard(element) {
  if (element?.inputMode === 'none') return false;
  if (element?.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly;
  return element instanceof HTMLInputElement && !element.readOnly && keyboardInputTypes.has(element.type);
}

function fitSheetToKeyboard(sheet, viewport) {
  let fitted = false;
  const reset = () => {
    sheet.removeAttribute('data-keyboard-viewport');
    sheet.style.removeProperty('--sheet-viewport-top');
    sheet.style.removeProperty('--sheet-viewport-height');
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
    // Keep the panel steady if a Save tap blurs the field before the keyboard
    // finishes closing.
    if (!fitted && (!sheet.contains(field) || !canOpenKeyboard(field))) return;
    sheet.style.setProperty('--sheet-viewport-top', `${Math.max(0, offsetTop)}px`);
    sheet.style.setProperty('--sheet-viewport-height', `${height}px`);
    sheet.setAttribute('data-keyboard-viewport', '');
    fitted = true;
  };
  sheet.addEventListener('focusin', update);
  const stopObserving = observeVisualViewport(update);
  return () => {
    stopObserving();
    sheet.removeEventListener('focusin', update);
    if (fitted) reset();
  };
}

const scrollLocks = new WeakMap();
function lockScroll(element) {
  let lock = scrollLocks.get(element);
  if (!lock) {
    lock = { count: 0, previous: element.style.overflow };
    scrollLocks.set(element, lock);
    element.style.overflow = 'hidden';
  }
  lock.count += 1;
  return () => {
    lock.count -= 1;
    if (lock.count === 0) {
      element.style.overflow = lock.previous;
      scrollLocks.delete(element);
    }
  };
}

export default Sheet;
