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
 *  - sidebar (≤3 riders): main panel (chart top-left, splits top-right, speedos band)
 *    + right sidebar (POV grid top ~70%, oval bottom ~30%).
 *  - wide (≥4 riders): top row of three equal columns (chart | splits | POV),
 *    speedometers full-width below; no oval.
 */
export default function RaceLayoutManager({ panels = {}, fieldSize = 0 }) {
  const wide = fieldSize >= 4;
  const p = (id, testid, cls) => <Slot id={id} panels={panels} testid={testid} cls={cls} />;

  if (wide) {
    return (
      <div className="race-layout race-layout--wide" data-testid="race-layout" data-mode="wide">
        <div className="race-layout__top3">
          {p('splitsChart', 'zone-splits', 'race-layout__zone--splits')}
          {p('distanceChart', 'zone-chart', 'race-layout__zone--chart')}
          {p('povGrid', 'zone-pov', 'race-layout__zone--pov')}
        </div>
        {p('speedoRow', 'zone-speedo', 'race-layout__zone--speedo')}
      </div>
    );
  }

  return (
    <div className="race-layout race-layout--sidebar" data-testid="race-layout" data-mode="sidebar">
      <div className="race-layout__main">
        <div className="race-layout__main-top">
          {p('splitsChart', 'zone-splits', 'race-layout__zone--splits')}
          {p('distanceChart', 'zone-chart', 'race-layout__zone--chart')}
        </div>
        {p('speedoRow', 'zone-speedo', 'race-layout__zone--speedo')}
      </div>
      <div className="race-layout__sidebar">
        {p('povGrid', 'zone-pov', 'race-layout__zone--pov')}
        {p('ovalTrack', 'zone-oval', 'race-layout__zone--oval')}
      </div>
    </div>
  );
}
RaceLayoutManager.propTypes = { panels: PropTypes.object, fieldSize: PropTypes.number };
