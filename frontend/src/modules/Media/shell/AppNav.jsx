import React from 'react';
import { useNav } from './NavProvider.jsx';

const ITEMS = [
  { view: 'home', label: 'Home', icon: '⌂' },
  { view: 'fleet', label: 'Devices', icon: '◧' },
  { view: 'browse', label: 'Browse', icon: '☷', params: { path: '' } },
];

export function AppNav() {
  const { view, push } = useNav();
  return (
    <nav data-testid="app-nav" className="app-nav" aria-label="Primary">
      {ITEMS.map((it) => (
        <button
          key={it.view}
          data-testid={`app-nav-${it.view}`}
          className={`app-nav-item ${view === it.view ? 'app-nav-item--active' : ''}`}
          onClick={() => push(it.view, it.params ?? {})}
          aria-current={view === it.view ? 'page' : undefined}
        >
          <span className="app-nav-icon" aria-hidden="true">{it.icon}</span>
          <span className="app-nav-label">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

export default AppNav;
