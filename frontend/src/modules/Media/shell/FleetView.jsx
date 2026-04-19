import React from 'react';
import { useFleetContext } from '../fleet/FleetProvider.jsx';
import { useNav } from './NavProvider.jsx';
import { useTakeOver } from '../peek/useTakeOver.js';

function stateLabel(entry) {
  if (!entry) return 'unknown';
  if (entry.offline) return `offline (last: ${entry.snapshot?.state ?? 'unknown'})`;
  return entry.snapshot?.state ?? 'unknown';
}

function currentItemLabel(entry) {
  const item = entry?.snapshot?.currentItem;
  if (!item) return '—';
  return item.title ?? item.contentId;
}

export function FleetView() {
  const { devices, byDevice, loading, error } = useFleetContext();
  const { push } = useNav();
  const takeOver = useTakeOver();

  if (loading) return <div data-testid="fleet-loading">Loading fleet…</div>;
  if (error) return <div data-testid="fleet-error">{error.message}</div>;
  if (!devices.length) return <div data-testid="fleet-empty">No playback devices configured.</div>;

  return (
    <div data-testid="fleet-view" className="fleet-view">
      <h1>Fleet</h1>
      <ul className="fleet-cards">
        {devices.map((d) => {
          const entry = byDevice.get(d.id);
          return (
            <li key={d.id} data-testid={`fleet-card-${d.id}`} className="fleet-card">
              <div className="fleet-card-name">{d.name ?? d.id}</div>
              <div className="fleet-card-type">{d.type}</div>
              <div className="fleet-card-state">{stateLabel(entry)}</div>
              <div className="fleet-card-item">{currentItemLabel(entry)}</div>
              {entry?.isStale && <span className="fleet-card-stale">stale</span>}
              <button
                data-testid={`fleet-peek-${d.id}`}
                onClick={() => push('peek', { deviceId: d.id })}
                className="fleet-peek-btn"
              >
                Peek
              </button>
              <button
                data-testid={`fleet-takeover-${d.id}`}
                onClick={() => takeOver(d.id)}
                className="fleet-takeover-btn"
              >
                Take Over
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default FleetView;
