import React from 'react';
import PropTypes from 'prop-types';
import PanelSlot from './panels/PanelSlot.jsx';
import './RaceLayoutManager.scss';

function Slot({ id, panels, testid, cls }) {
  const factory = id ? panels[id] : null;
  return (
    <div className={`race-layout__zone ${cls}${factory ? '' : ' race-layout__zone--empty'}`} data-testid={testid}>
      {factory ? <PanelSlot key={id} panelId={id} render={factory} /> : null}
    </div>
  );
}
Slot.propTypes = { id: PropTypes.string, panels: PropTypes.object, testid: PropTypes.string, cls: PropTypes.string };

/**
 * Fixed race layout, chosen by field size:
 *  - sidebar (≤3 riders): main panel (chart fills the row, speedos band)
 *    + right sidebar (POV grid top ~70%, standings tower bottom ~30% — the
 *    tower REPLACES the oval's slot; the oval's lap strip folds into the
 *    tower's own header row instead).
 *  - wide (≥4 riders): top row of chart (2×) | standings tower, speedometers
 *    full-width below, plus the POV grid docked as a right-edge column spanning
 *    the full height (audit UX §4.2 — wide mode used to lose rank/lap info
 *    entirely; now it never does).
 */
export default function RaceLayoutManager({ panels = {}, fieldSize = 0 }) {
  const wide = fieldSize >= 4;
  // The speedometer band is only present in a live race; recap/playback omits it
  // (showSpeedos=false → no speedoRow panel). When it's absent we must NOT reserve
  // its grid track, or the chart/splits row gets starved by the speedo row's
  // min-height floor and a dead band fills the rest. So both the zone AND its
  // track are conditional on the panel actually existing.
  const hasSpeedo = !!panels.speedoRow;
  const noSpeedo = hasSpeedo ? '' : ' race-layout--no-speedo';
  const p = (id, testid, cls) => <Slot id={id} panels={panels} testid={testid} cls={cls} />;

  if (wide) {
    return (
      <div className={`race-layout race-layout--wide${noSpeedo}`} data-testid="race-layout" data-mode="wide">
        <div className={`race-layout__wide-main${hasSpeedo ? '' : ' race-layout__wide-main--no-speedo'}`}>
          <div className="race-layout__top3">
            {p('distanceChart', 'zone-chart', 'race-layout__zone--chart')}
            {p('standingsTower', 'zone-tower', 'race-layout__zone--tower')}
          </div>
          {hasSpeedo && p('speedoRow', 'zone-speedo', 'race-layout__zone--speedo')}
        </div>
        {p('povGrid', 'zone-pov', 'race-layout__zone--pov')}
      </div>
    );
  }

  return (
    <div className={`race-layout race-layout--sidebar${noSpeedo}`} data-testid="race-layout" data-mode="sidebar">
      <div className={`race-layout__main${hasSpeedo ? '' : ' race-layout__main--no-speedo'}`}>
        <div className="race-layout__main-top">
          {p('distanceChart', 'zone-chart', 'race-layout__zone--chart')}
        </div>
        {hasSpeedo && p('speedoRow', 'zone-speedo', 'race-layout__zone--speedo')}
      </div>
      <div className="race-layout__sidebar">
        {p('povGrid', 'zone-pov', 'race-layout__zone--pov')}
        {p('standingsTower', 'zone-tower', 'race-layout__zone--tower')}
      </div>
    </div>
  );
}
RaceLayoutManager.propTypes = { panels: PropTypes.object, fieldSize: PropTypes.number };
