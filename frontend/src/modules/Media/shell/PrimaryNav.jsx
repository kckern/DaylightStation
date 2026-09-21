// frontend/src/modules/Media/shell/PrimaryNav.jsx
// Primary navigation. Mobile: bottom tab bar. Tablet+: left rail (icons,
// labels at desktop width). Both are the same three destinations; ownership
// comes from NavProvider so nested controls never lose their primary area.
import React from 'react';
import { UnstyledButton } from '@mantine/core';
import { IconHome, IconLayoutGrid, IconDevices } from '@tabler/icons-react';
import { useNav } from './NavProvider.jsx';

const ITEMS = [
  { area: 'home', label: 'Home', Icon: IconHome },
  { area: 'browse', label: 'Browse', Icon: IconLayoutGrid },
  { area: 'fleet', label: 'Devices', Icon: IconDevices },
];

function navItems(area, goToArea, idPrefix) {
  return ITEMS.map(({ area: itemArea, label, Icon }) => (
    <UnstyledButton
      key={itemArea}
      data-testid={`${idPrefix}-${itemArea}`}
      className={`media-nav-item ${area === itemArea ? 'media-nav-item--active' : ''}`}
      aria-current={area === itemArea ? 'page' : undefined}
      onClick={() => goToArea(itemArea)}
    >
      <span className="media-nav-icon-wrap"><Icon size={22} stroke={1.6} aria-hidden /></span>
      <span className="media-nav-label">{label}</span>
    </UnstyledButton>
  ));
}

export function NavRail() {
  const { area, goToArea } = useNav();
  return (
    <nav className="media-nav-rail" data-testid="app-nav" aria-label="Primary">
      {navItems(area, goToArea, 'app-nav')}
    </nav>
  );
}

export function TabBar() {
  const { area, goToArea } = useNav();
  return (
    <nav className="media-tabbar" data-testid="app-tabbar" aria-label="Primary">
      {navItems(area, goToArea, 'app-tab')}
    </nav>
  );
}

export default NavRail;
