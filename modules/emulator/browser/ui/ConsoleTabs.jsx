/**
 * ConsoleTabs — bottom tab strip for the arcade shell.
 *
 * Real consoles (placeholder:false) are selectable and labeled; placeholder
 * slots render as blank, disabled tabs for not-yet-built systems. Fully
 * config-driven — the list comes from the library's `consoles`.
 */

import React from 'react';

export function ConsoleTabs({ consoles = [], activeSystem, onSelect }) {
  return (
    <div className="emu-console-tabs" role="tablist">
      {consoles.map((c, i) => {
        if (c.placeholder) {
          return (
            <span
              key={`placeholder-${i}`}
              className="emu-console-tab emu-console-tab--placeholder"
              aria-hidden="true"
            >
              {c.label || ''}
            </span>
          );
        }
        const active = c.system === activeSystem;
        return (
          <button
            key={c.system}
            type="button"
            role="tab"
            aria-selected={active}
            className={`emu-console-tab${active ? ' is-active' : ''}`}
            onPointerDown={() => onSelect?.(c.system)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(c.system); }
            }}
          >
            {c.label || c.system}
          </button>
        );
      })}
    </div>
  );
}

export default ConsoleTabs;
