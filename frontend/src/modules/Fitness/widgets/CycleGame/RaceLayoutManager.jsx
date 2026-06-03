import React, { useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import PanelSlot from './panels/PanelSlot.jsx';
import { panelById } from '@/modules/Fitness/lib/cycleGame/racePanels.js';
import { columnTemplateFor } from '@/modules/Fitness/lib/cycleGame/layoutSizing.js';
import { createThrashDetector } from '@/modules/Fitness/lib/cycleGame/layoutMonitor.js';
import getLogger from '@/lib/logging/Logger.js';
import './RaceLayoutManager.scss';

const TOP = ['topLeft', 'topCenter', 'topRight'];
// Speedo band: the gauges are the key feedback, so reserve ~half the height with
// a hard pixel floor so they never shrink to illegible. minmax keeps it stable
// (depends only on container height, not content); collapses to 0 when empty.
const BOTTOM_BAND = 'minmax(240px, 48%)';

export default function RaceLayoutManager({ decision, panels }) {
  const zones = decision?.zones || {};
  const filledTop = TOP.filter((z) => zones[z]);
  // Columns weighted by each filled top panel's sizeHint (focus wider than standard).
  const topCols = columnTemplateFor(filledTop.map((z) => panelById(zones[z])?.sizeHint || 'standard'));
  // Deterministic rows: a stable bottom band when the speedo row is present (so its
  // zone box doesn't depend on content), collapsed when absent.
  const rows = `1fr ${zones.bottom ? BOTTOM_BAND : '0px'}`;

  // Telemetry + thrash warn: log the layout on change; warn if it churns too fast.
  const log = useMemo(() => getLogger().child({ component: 'cycle-race-layout' }), []);
  const detector = useMemo(() => createThrashDetector({ windowMs: 2000, threshold: 8 }), []);
  const sig = `${rows}|${topCols}|${TOP.map((z) => zones[z] || '-').join(',')}|${zones.bottom || '-'}`;
  const lastSigRef = useRef(null);
  useEffect(() => {
    if (lastSigRef.current === sig) return;
    lastSigRef.current = sig;
    const now = Date.now();
    log.debug('cycle_game.layout', { rows, topCols, zones });
    if (detector.record(now) >= 8) {
      log.warn('cycle_game.layout_thrash', { count: detector.count(now), windowMs: 2000, zones });
    }
  }, [sig, rows, topCols, zones, log, detector]);

  const renderZone = (zone) => {
    const id = zones[zone];
    const Panel = id ? panels[id] : null;
    return (
      <div key={zone} data-testid={`zone-${zone}`}
        className={`race-layout__zone race-layout__zone--${zone}${Panel ? '' : ' race-layout__zone--empty'}`}>
        {Panel ? <PanelSlot key={id} panelId={id}><Panel /></PanelSlot> : null}
      </div>
    );
  };
  return (
    <div className="race-layout" style={{ '--rows': rows }}>
      <div className="race-layout__top" style={{ '--top-cols': topCols }}>{TOP.map(renderZone)}</div>
      {renderZone('bottom')}
    </div>
  );
}
RaceLayoutManager.propTypes = { decision: PropTypes.object, panels: PropTypes.object };
