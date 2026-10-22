import React from 'react';
import { createPortal } from 'react-dom';

// Dims everything left of the sidebar while its menu is open. Portalled to the
// body: the sidebar sets `contain: layout`, which traps a fixed-position child
// inside the sidebar box, so an in-place scrim never reached the video and a tap
// there toggled the player's fullscreen instead of closing the menu. The menu
// itself still fills the sidebar, so the scrim stops at the sidebar's left edge.
export default function SidebarMenuScrim({ anchorRef, onClose }) {
  if (typeof document === 'undefined') return null;
  const left = anchorRef?.current?.getBoundingClientRect?.().left;
  const style = Number.isFinite(left) && left > 0 ? { width: `${Math.round(left)}px` } : undefined;
  const close = (event) => {
    event.stopPropagation();
    onClose?.();
  };
  return createPortal(
    <div
      className="sidebar-menu-overlay"
      data-no-fullscreen
      style={style}
      onPointerDown={close}
    />,
    document.body
  );
}
