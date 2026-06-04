import React from 'react';
import PropTypes from 'prop-types';
import OvalTrack from './OvalTrack.jsx';
import LapTable from './LapTable.jsx';
import './LapPanel.scss';

/**
 * Combined lap panel — the velodrome oval (whole-race progress loop) over the
 * growing per-lap split table, in a single zone. Merges what used to be two
 * separate director panels (oval track + lap table) so lap context reads as one
 * unit. Pure presentational; forwards to the two sub-panels.
 */
export default function LapPanel({ riderIds, riders, riderLive = {}, progress = {}, lapSplits = {} }) {
  return (
    <div className="cg-lap-panel" data-testid="lap-panel">
      <div className="cg-lap-panel__oval">
        <OvalTrack riderIds={riderIds} riders={riders} riderLive={riderLive} progress={progress} />
      </div>
      <div className="cg-lap-panel__table">
        <LapTable riderIds={riderIds} riders={riders} lapSplits={lapSplits} />
      </div>
    </div>
  );
}

LapPanel.propTypes = {
  riderIds: PropTypes.array.isRequired,
  riders: PropTypes.object.isRequired,
  riderLive: PropTypes.object,
  progress: PropTypes.object,
  lapSplits: PropTypes.object
};
