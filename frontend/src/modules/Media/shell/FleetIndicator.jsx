import React from 'react';
import { useFleetSummary } from '../fleet/useFleetSummary.js';
import { useNav } from './NavProvider.jsx';

export function FleetIndicator() {
  const { total, online } = useFleetSummary();
  const { push } = useNav();
  return (
    <button
      data-testid="fleet-indicator"
      onClick={() => push('fleet', {})}
      className={`fleet-indicator ${online > 0 ? 'fleet-indicator--online' : 'fleet-indicator--offline'}`}
      title="Fleet"
    >
      Fleet {online}/{total}
    </button>
  );
}

export default FleetIndicator;
