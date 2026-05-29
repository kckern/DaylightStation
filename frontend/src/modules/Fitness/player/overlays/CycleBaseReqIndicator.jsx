import React from 'react';
import PropTypes from 'prop-types';
import './CycleBaseReqIndicator.scss';

export const CycleBaseReqIndicator = ({ baseReqSatisfied, waitingForBaseReq, compact = false }) => {
  let mode = 'inactive';
  let label = 'Heart-rate gate inactive';
  if (baseReqSatisfied) {
    mode = 'satisfied';
    label = 'Heart-rate zone satisfied';
  } else if (waitingForBaseReq) {
    mode = 'waiting';
    label = 'Waiting for heart-rate zone';
  }
  return (
    <div
      className={`cycle-base-req cycle-base-req--${mode}${compact ? ' cycle-base-req--compact' : ''}`}
      role="status"
      aria-label={label}
    >
      <span
        data-testid="base-req-dot"
        className={`cycle-base-req__dot cycle-base-req__dot--${mode}`}
      />
      {!compact && <span className="cycle-base-req__label">{label}</span>}
    </div>
  );
};

CycleBaseReqIndicator.propTypes = {
  baseReqSatisfied: PropTypes.bool,
  waitingForBaseReq: PropTypes.bool,
  compact: PropTypes.bool
};

export default CycleBaseReqIndicator;
