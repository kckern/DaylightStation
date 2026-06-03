import React from 'react';
import PropTypes from 'prop-types';
import PanelSlot from './panels/PanelSlot.jsx';
import './RaceLayoutManager.scss';

const TOP = ['topLeft', 'topCenter', 'topRight'];

export default function RaceLayoutManager({ decision, panels }) {
  const zones = decision?.zones || {};
  const filledTop = TOP.filter((z) => zones[z]).length || 1;
  const renderZone = (zone) => {
    const id = zones[zone];
    const Panel = id ? panels[id] : null;
    return (
      <div key={zone} data-testid={`zone-${zone}`}
        className={`race-layout__zone race-layout__zone--${zone}${Panel ? '' : ' race-layout__zone--empty'}`}>
        {Panel ? <PanelSlot panelId={id}><Panel /></PanelSlot> : null}
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
