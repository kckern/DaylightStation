import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import SidebarMenuScrim from './SidebarMenuScrim.jsx';

const anchorAt = (left) => ({ current: { getBoundingClientRect: () => ({ left, top: 0, width: 250, height: 777 }) } });

describe('SidebarMenuScrim', () => {
  it('renders on the body, outside the sidebar, so it covers the video', () => {
    const { container } = render(<div className="sidebar"><SidebarMenuScrim anchorRef={anchorAt(1131)} onClose={() => {}} /></div>);
    expect(container.querySelector('.sidebar-menu-overlay')).toBeNull();
    const scrim = document.body.querySelector(':scope > .sidebar-menu-overlay');
    expect(scrim).toBeTruthy();
    expect(scrim.style.width).toBe('1131px');
  });

  it('never lets its tap toggle the player fullscreen', () => {
    render(<SidebarMenuScrim anchorRef={anchorAt(1131)} onClose={() => {}} />);
    expect(document.body.querySelector('.sidebar-menu-overlay').hasAttribute('data-no-fullscreen')).toBe(true);
  });

  it('closes the menu on the first pointer down and stops the event', () => {
    const onClose = vi.fn();
    const outer = vi.fn();
    render(<div onPointerDown={outer}><SidebarMenuScrim anchorRef={anchorAt(1131)} onClose={onClose} /></div>);
    fireEvent.pointerDown(document.body.querySelector('.sidebar-menu-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});
