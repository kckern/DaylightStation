import React from 'react';
import './components.scss';

export function ControlLegend({ items = [] }) {
  return (
    <div className="gp-legend" data-testid="control-legend">
      {items.map((item) => (
        <span key={item.label} className="gp-legend__item">
          <kbd>{item.key}</kbd> {item.label}
        </span>
      ))}
    </div>
  );
}
export default ControlLegend;
