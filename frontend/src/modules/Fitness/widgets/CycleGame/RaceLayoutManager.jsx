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

export default function RaceLayoutManager({ decision, panels, solo = false, fieldSize = 0 }) {
  const zones = decision?.zones || {};
  const filledTop = TOP.filter((z) => zones[z]);
  // Columns weighted by each filled top panel's sizeHint (focus wider than standard).
  const topCols = columnTemplateFor(filledTop.map((z) => panelById(zones[z])?.sizeHint || 'standard'));
  // Deterministic rows: a stable bottom band when the speedo row is present (so its
  // zone box doesn't depend on content), collapsed when absent. A SMALL field gets a
  // taller band so the (fewer) gauges grow to fill it instead of floating.
  const bottomBand = fieldSize > 0 && fieldSize <= 3 ? 'minmax(280px, 54%)' : BOTTOM_BAND;
  const rows = `1fr ${zones.bottom ? bottomBand : '0px'}`;

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

  // Render one panel into a zone div. `cls` overrides the zone class so the solo
  // branch can reuse the same PanelSlot wiring (zoneBox flows) with its own layout.
  const renderPanel = (id, testid, cls) => {
    // Pass the factory as `render` (PanelSlot CALLS it) — NOT as <Panel /> (a
    // component type). The factory identity changes every tick, so using it as a
    // type remounts the whole panel each frame (avatar reload, transition reset).
    const factory = id ? panels[id] : null;
    return (
      <div data-testid={testid}
        className={`race-layout__zone ${cls}${factory ? '' : ' race-layout__zone--empty'}`}>
        {factory ? <PanelSlot key={id} panelId={id} render={factory} /> : null}
      </div>
    );
  };
  const renderZone = (zone) => renderPanel(zones[zone], `zone-${zone}`, `race-layout__zone--${zone}`);

  // Solo (one participant): the director already chose the right top panel (chart
  // vs lapTable via candidacy) and put the speedo in `bottom`. Re-arrange those two
  // into balanced 50/50 columns — gauge left, that top panel right — instead of the
  // top-row-over-band velodrome. Each half keeps its PanelSlot so zoneBox still flows.
  if (solo) {
    const rightId = filledTop.length ? zones[filledTop[0]] : null;
    return (
      <div className="race-layout race-layout--solo" data-testid="race-layout-solo">
        {renderPanel(zones.bottom, 'zone-solo-left', 'race-layout__zone--solo-left')}
        {renderPanel(rightId, 'zone-solo-right', 'race-layout__zone--solo-right')}
      </div>
    );
  }

  return (
    <div className="race-layout" style={{ '--rows': rows }}>
      <div className="race-layout__top" style={{ '--top-cols': topCols }}>{TOP.map(renderZone)}</div>
      {renderZone('bottom')}
    </div>
  );
}
RaceLayoutManager.propTypes = { decision: PropTypes.object, panels: PropTypes.object, solo: PropTypes.bool, fieldSize: PropTypes.number };
