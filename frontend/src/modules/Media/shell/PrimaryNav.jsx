// frontend/src/modules/Media/shell/PrimaryNav.jsx
// Primary navigation. Mobile: bottom tab bar. Tablet+: left rail (icons,
// labels at desktop width). Both are the same three destinations; Detail
// highlights Browse, Peek highlights Fleet.
import React from 'react';
import { UnstyledButton } from '@mantine/core';
import { IconHome, IconLayoutGrid, IconDevices } from '@tabler/icons-react';
import { useNav } from './NavProvider.jsx';

const ITEMS = [
  { view: 'home', label: 'Home', Icon: IconHome },
  { view: 'browse', label: 'Browse', Icon: IconLayoutGrid, params: { path: '' } },
  { view: 'fleet', label: 'Devices', Icon: IconDevices },
];

// nowPlaying deliberately highlights no nav tab: its visible anchor is the
// mini player, which lights up (mini-player--active) while the view is open.
const HIGHLIGHT = { detail: 'browse', peek: 'fleet', nowPlaying: null };

function navItems(view, push, idPrefix) {
  const active = HIGHLIGHT[view] !== undefined ? HIGHLIGHT[view] : view;
  return ITEMS.map(({ view: v, label, Icon, params }) => (
    <UnstyledButton
      key={v}
      data-testid={`${idPrefix}-${v}`}
      className={`media-nav-item ${active === v ? 'media-nav-item--active' : ''}`}
      aria-current={active === v ? 'page' : undefined}
      onClick={() => push(v, params ?? {})}
    >
      <Icon size={22} stroke={1.6} aria-hidden />
      <span className="media-nav-label">{label}</span>
    </UnstyledButton>
  ));
}

export function NavRail() {
  const { view, push } = useNav();
  return (
    <nav className="media-nav-rail" data-testid="app-nav" aria-label="Primary">
      {navItems(view, push, 'app-nav')}
    </nav>
  );
}

export function TabBar() {
  const { view, push } = useNav();
  return (
    <nav className="media-tabbar" data-testid="app-tabbar" aria-label="Primary">
      {navItems(view, push, 'app-tab')}
    </nav>
  );
}

export default NavRail;
