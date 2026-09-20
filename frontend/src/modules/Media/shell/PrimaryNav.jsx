// frontend/src/modules/Media/shell/PrimaryNav.jsx
// Primary navigation. Mobile: bottom tab bar. Tablet+: left rail (icons,
// labels at desktop width). Both are the same three destinations; ownership
// comes from NavProvider so nested controls never lose their primary area.
import React from 'react';
import { UnstyledButton } from '@mantine/core';
import { IconHome, IconLayoutGrid, IconDevices } from '@tabler/icons-react';
import { useNav } from './NavProvider.jsx';
import { useFleetSummary } from '../fleet/useFleetSummary.js';

const ITEMS = [
  { area: 'home', label: 'Home', Icon: IconHome },
  { area: 'browse', label: 'Browse', Icon: IconLayoutGrid },
  { area: 'fleet', label: 'Devices', Icon: IconDevices },
];

// Fleet-at-a-glance used to be the dock's FleetIndicator ("Devices 2/5"),
// which is gone at mobile widths now (Dock.jsx, Task 13) — nothing else on
// mobile said whether a device was actively playing. A badge on the Devices
// tab replaces it: a count of devices with something actually happening
// (playing/paused/buffering/stalled — see useFleetSummary's ACTIVE_STATES),
// shown at every width the tab bar/rail render at, since it's cheap and
// desktop still benefits from the at-a-glance signal even though its Dock
// keeps the full indicator too.
function navItems(area, goToArea, idPrefix, fleetActive) {
  return ITEMS.map(({ area: itemArea, label, Icon }) => (
    <UnstyledButton
      key={itemArea}
      data-testid={`${idPrefix}-${itemArea}`}
      className={`media-nav-item ${area === itemArea ? 'media-nav-item--active' : ''}`}
      aria-current={area === itemArea ? 'page' : undefined}
      onClick={() => goToArea(itemArea)}
    >
      <span className="media-nav-icon-wrap">
        <Icon size={22} stroke={1.6} aria-hidden />
        {itemArea === 'fleet' && fleetActive > 0 && (
          <span className="media-nav-badge" data-testid={`${idPrefix}-fleet-badge`}>{fleetActive}</span>
        )}
      </span>
      <span className="media-nav-label">{label}</span>
    </UnstyledButton>
  ));
}

export function NavRail() {
  const { area, goToArea } = useNav();
  const { active } = useFleetSummary();
  return (
    <nav className="media-nav-rail" data-testid="app-nav" aria-label="Primary">
      {navItems(area, goToArea, 'app-nav', active)}
    </nav>
  );
}

export function TabBar() {
  const { area, goToArea } = useNav();
  const { active } = useFleetSummary();
  return (
    <nav className="media-tabbar" data-testid="app-tabbar" aria-label="Primary">
      {navItems(area, goToArea, 'app-tab', active)}
    </nav>
  );
}

export default NavRail;
