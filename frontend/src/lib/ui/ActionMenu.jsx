import { useLayoutEffect, useRef, useState } from 'react';
import { Menu } from '@mantine/core';
import { useViewOverlaysActive } from './AppFrame.jsx';
import { useDismissLayer } from './dismiss/useDismissLayer.js';

function focusFirstAction(dropdown) {
  if (!dropdown) return;
  const first = dropdown.querySelector('[role="menuitem"]:not(:disabled):not([aria-disabled="true"])');
  (first ?? dropdown).focus({ preventScroll: true });
}

/** Enter a transient action menu and return to the trigger for Escape or Tab traversal. */
export function ActionMenu({ trigger, dropdownProps, children, disabled, ...positioning }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const enabled = useViewOverlaysActive() && !disabled;
  useLayoutEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);
  const dismiss = () => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };
  useDismissLayer(open && enabled, dismiss);

  function onMenuKeyDown(event) {
    if (event.defaultPrevented) return;
    if (event.key === 'Tab') {
      // Let the browser traverse from the trigger in its original document order.
      dismiss();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    }
  }

  return (
    <Menu
      {...positioning}
      disabled={disabled}
      opened={open && enabled}
      onChange={next => setOpen(enabled && next)}
      closeOnEscape={false}
      trapFocus={false}
      transitionProps={{ duration: 0 }}
    >
      <Menu.Target ref={triggerRef}>{trigger}</Menu.Target>
      <Menu.Dropdown {...dropdownProps} ref={focusFirstAction} onKeyDownCapture={onMenuKeyDown}>
        {children}
      </Menu.Dropdown>
    </Menu>
  );
}
