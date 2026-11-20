import { useLayoutEffect } from 'react';
import { hideOthers } from 'aria-hidden';
import { tabbable } from 'tabbable';

const dialogSelector = 'dialog, [role="dialog"], [role="alertdialog"]';

function keepTabInPanel(event) {
  if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const panel = event.currentTarget;
  const focused = event.target;
  if (!panel.contains(focused) || focused.closest(dialogSelector) !== panel.closest(dialogSelector)) return;

  const stops = tabbable(panel);
  const backwards = event.shiftKey;
  const edge = backwards ? stops[0] : stops.at(-1);
  // A programmatically focused loading region can sit beyond the last tab stop.
  const beyondEdge = edge && !stops.includes(focused) && Boolean(focused.compareDocumentPosition(edge) & (
    backwards ? Node.DOCUMENT_POSITION_FOLLOWING : Node.DOCUMENT_POSITION_PRECEDING
  ));
  if (edge && focused !== panel && focused !== edge && !beyondEdge) return;
  event.preventDefault();
  (backwards ? stops.at(-1) : stops[0])?.focus();
}

/** Return the dialog panel's key handler and place initial focus for an active visit. */
export function useDialogFocus(active, panelRef, fallbackRef) {
  useLayoutEffect(() => {
    if (!active) return undefined;
    const panel = panelRef.current;
    const owner = panel.ownerDocument;
    const bodyRoot = Array.from(owner.body.children).find(node => node.contains(panel));
    const unhide = bodyRoot ? hideOthers(bodyRoot) : undefined;
    const opening = setTimeout(() => {
      if (panel.contains(owner.activeElement)) return;
      panel.querySelector('[data-autofocus]')?.focus({ preventScroll: true });
      if (!panel.contains(owner.activeElement)) fallbackRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => {
      clearTimeout(opening);
      unhide?.();
    };
  }, [active, panelRef, fallbackRef]);

  return keepTabInPanel;
}
