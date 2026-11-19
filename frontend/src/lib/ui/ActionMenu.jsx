import { useRef, useState } from 'react';
import { Menu } from '@mantine/core';
import { useDismissLayer } from './dismiss/useDismissLayer.js';

function focusDropdown(dropdown) {
  // The mounted portal can receive Escape before Mantine's focus trap runs.
  dropdown?.focus({ preventScroll: true });
}

/** Render Mantine menu items with one Escape owner and a stable return target. */
export function ActionMenu({ trigger, dropdownProps, children, ...positioning }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const dismiss = () => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };
  useDismissLayer(open, dismiss);

  function onMenuKeyDown(event) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  }

  return (
    <Menu
      {...positioning}
      opened={open}
      onChange={setOpen}
      closeOnEscape={false}
      // Remove the closed dropdown before pending autofocus can target it.
      transitionProps={{ duration: 0 }}
    >
      <Menu.Target ref={triggerRef}>{trigger}</Menu.Target>
      <Menu.Dropdown {...dropdownProps} ref={focusDropdown} onKeyDownCapture={onMenuKeyDown}>
        {children}
      </Menu.Dropdown>
    </Menu>
  );
}
