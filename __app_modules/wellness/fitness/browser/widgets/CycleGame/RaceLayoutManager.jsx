import React from 'react';
import PropTypes from 'prop-types';
import PanelSlot from "./panels/PanelSlot.jsx";
import "./RaceLayoutManager.scss";

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
 * Fixed race layout. CycleRaceScreen picks the `mode` (raceLayoutMode, from
 * the live-rider count and the field size):
 *  - solo (one live rider, at most one rival): chart across the top (~55% of
 *    the height); below it a band with the rider's gauge on the left and the
 *    pace-delta panel filling the rest; the POV road as a right column (~28%).
 *    No standings tower: with one rider there is nobody to rank.
 *  - sidebar: main panel (chart fills the row, speedos band) + right sidebar
 *    (POV grid top ~70%, standings tower bottom ~30% — the tower REPLACES the
 *    oval's slot; the oval's lap strip folds into the tower's own header row).
 *  - wide (4+ on the road): top row of chart (2x) | standings tower | POV road,
 *    and the speedometers across the FULL width below all three. Each gauge is
 *    the band width / `speedoCount` (layoutSizing.wideGaugeSize) and the band is
 *    exactly that tall plus its chrome, so N gauges always fit across and the
 *    top row (tower, road) keeps the rest of the height.
 */
export default function RaceLayoutManager({ panels = {}, mode = 'sidebar', speedoCount = 0 }) {
  // The speedometer band is only present in a live race; recap/playback omits it
  // (showSpeedos=false → no speedoRow panel). When it's absent we must NOT reserve
  // its grid track, or the chart/splits row gets starved by the speedo row's
  // min-height floor and a dead band fills the rest. So both the zone AND its
  // track are conditional on the panel actually existing.
  const hasSpeedo = !!panels.speedoRow;
  const noSpeedo = hasSpeedo ? '' : ' race-layout--no-speedo';
  const p = (id, testid, cls) => <Slot id={id} panels={panels} testid={testid} cls={cls} />;

  if (mode === 'solo') {
    return (
      <div className={`race-layout race-layout--solo${noSpeedo}`} data-testid="race-layout" data-mode="solo">
        <div className="race-layout__solo-main">
          {p('distanceChart', 'zone-chart', 'race-layout__zone--chart')}
          <div className={`race-layout__solo-band${hasSpeedo ? '' : ' race-layout__solo-band--no-speedo'}`}>
            {hasSpeedo && p('speedoRow', 'zone-speedo', 'race-layout__zone--speedo')}
            {p('paceDelta', 'zone-pace', 'race-layout__zone--pace')}
          </div>
        </div>
        {p('povGrid', 'zone-pov', 'race-layout__zone--pov')}
      </div>
    );
  }

  if (mode === 'wide') {
    // The host is the size container the band's height is computed against
    // (container units resolve against an ANCESTOR, never the element itself).
    return (
      <div className="race-layout-host" style={{ '--cg-speedo-n': Math.max(1, speedoCount || 1) }}>
      <div className={`race-layout race-layout--wide${noSpeedo}`} data-testid="race-layout" data-mode="wide">
        <div className="race-layout__wide-top">
          <div className="race-layout__top3">
            {p('distanceChart', 'zone-chart', 'race-layout__zone--chart')}
            {p('standingsTower', 'zone-tower', 'race-layout__zone--tower')}
          </div>
          {p('povGrid', 'zone-pov', 'race-layout__zone--pov')}
        </div>
        {hasSpeedo && p('speedoRow', 'zone-speedo', 'race-layout__zone--speedo')}
      </div>
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
RaceLayoutManager.propTypes = { panels: PropTypes.object, mode: PropTypes.oneOf(['solo', 'sidebar', 'wide']) };
