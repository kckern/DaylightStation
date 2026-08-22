// frontend/src/modules/Media/shell/PrimaryNav.jsx
// Primary navigation. Mobile: bottom tab bar. Tablet+: left rail (icons,
// labels at desktop width). Both are the same three destinations; Detail
// highlights Browse, Peek highlights Fleet.
import React from 'react';
import { UnstyledButton } from '@mantine/core';
import { IconHome, IconLayoutGrid, IconDevices } from '@tabler/icons-react';
import { useNav } from './NavProvider.jsx';
import { useFleetSummary } from '../fleet/useFleetSummary.js';

const ITEMS = [
  { view: 'home', label: 'Home', Icon: IconHome },
  { view: 'browse', label: 'Browse', Icon: IconLayoutGrid, params: { path: '' } },
  { view: 'fleet', label: 'Devices', Icon: IconDevices },
];

// nowPlaying deliberately highlights no nav tab: its visible anchor is the
// mini player, which lights up (mini-player--active) while the view is open.
const HIGHLIGHT = { detail: 'browse', peek: 'fleet', nowPlaying: null };

// Fleet-at-a-glance used to be the dock's FleetIndicator ("Devices 2/5"),
// which is gone at mobile widths now (Dock.jsx, Task 13) — nothing else on
// mobile said whether a device was actively playing. A badge on the Devices
// tab replaces it: a count of devices with something actually happening
// (playing/paused/buffering/stalled — see useFleetSummary's ACTIVE_STATES),
// shown at every width the tab bar/rail render at, since it's cheap and
// desktop still benefits from the at-a-glance signal even though its Dock
// keeps the full indicator too.
function navItems(view, push, idPrefix, fleetActive) {
  const active = HIGHLIGHT[view] !== undefined ? HIGHLIGHT[view] : view;
  return ITEMS.map(({ view: v, label, Icon, params }) => (
    <UnstyledButton
      key={v}
      data-testid={`${idPrefix}-${v}`}
      className={`media-nav-item ${active === v ? 'media-nav-item--active' : ''}`}
      aria-current={active === v ? 'page' : undefined}
      onClick={() => push(v, params ?? {})}
    >
      <span className="media-nav-icon-wrap">
        <Icon size={22} stroke={1.6} aria-hidden />
        {v === 'fleet' && fleetActive > 0 && (
          <span className="media-nav-badge" data-testid={`${idPrefix}-fleet-badge`}>{fleetActive}</span>
        )}
      </span>
      <span className="media-nav-label">{label}</span>
    </UnstyledButton>
  ));
}

export function NavRail() {
  const { view, push } = useNav();
  const { active } = useFleetSummary();
  return (
    <nav className="media-nav-rail" data-testid="app-nav" aria-label="Primary">
      {navItems(view, push, 'app-nav', active)}
    </nav>
  );
}

export function TabBar() {
  const { view, push } = useNav();
  const { active } = useFleetSummary();
  return (
    <nav className="media-tabbar" data-testid="app-tabbar" aria-label="Primary">
      {navItems(view, push, 'app-tab', active)}
    </nav>
  );
}

export default NavRail;
