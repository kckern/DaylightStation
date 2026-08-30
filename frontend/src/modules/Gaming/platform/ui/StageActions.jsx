import React from 'react';
import './components.scss';

export function StageActions({ children, align = 'center' }) {
  return <div className={`gp-stage-actions gp-stage-actions--${align}`}>{children}</div>;
}

export default StageActions;
