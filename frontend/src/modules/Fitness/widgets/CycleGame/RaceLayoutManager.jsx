import React, { useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import PanelSlot from './panels/PanelSlot.jsx';
import getLogger from '@/lib/logging/Logger.js';
import './RaceLayoutManager.scss';

const TOP = ['topLeft', 'topCenter', 'topRight'];

export default function RaceLayoutManager({ decision, panels }) {
  const zones = decision?.zones || {};
  const filledTop = TOP.filter((z) => zones[z]).length || 1;

  // Telemetry: log the layout whenever the zone assignment or the top-column
  // count changes. filledTop drives the top grid's column count; churn here is
  // what reflows the chart + speedo band, so this surfaces layout thrashing.
  const log = useMemo(() => getLogger().child({ component: 'cycle-race-layout' }), []);
  const sig = `${filledTop}|${TOP.map((z) => zones[z] || '-').join(',')}|${zones.bottom || '-'}`;
  const lastSigRef = useRef(null);
  useEffect(() => {
    if (lastSigRef.current === sig) return;
    lastSigRef.current = sig;
    log.debug('cycle_game.layout', { filledTop, zones });
  }, [sig, filledTop, zones, log]);

  const renderZone = (zone) => {
    const id = zones[zone];
    const Panel = id ? panels[id] : null;
    return (
      <div key={zone} data-testid={`zone-${zone}`}
        className={`race-layout__zone race-layout__zone--${zone}${Panel ? '' : ' race-layout__zone--empty'}`}>
        {/* key on the slot WHERE IT'S USED so an in-zone panel swap remounts the
            slot and re-fires the race-slot-in enter animation (a key on the slot's
            own returned root would not). */}
        {Panel ? <PanelSlot key={id} panelId={id}><Panel /></PanelSlot> : null}
      </div>
    );
  };
  return (
    <div className="race-layout" style={{ '--top-filled': filledTop }}>
      <div className="race-layout__top">{TOP.map(renderZone)}</div>
      {renderZone('bottom')}
    </div>
  );
}
RaceLayoutManager.propTypes = { decision: PropTypes.object, panels: PropTypes.object };
