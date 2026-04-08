// frontend/src/modules/Fitness/widgets/FitnessLongitudinalWidget/SparklineRow.jsx
import React from 'react';

export default function SparklineRow({
  label,
  data,
  color = 'rgba(34,139,230,0.6)',
  highlightColor,
  highlightFn,
  centerZero = false,
  positiveColor = 'rgba(200,80,40,0.4)',
  negativeColor = 'rgba(80,200,120,0.5)',
  maxValue,
  selectedIndex,
  onColumnClick,
}) {
  const values = data.map(d => (d == null ? 0 : d));
  const absMax = maxValue || Math.max(...values.map(Math.abs), 1);

  if (centerZero) {
    return (
      <div className="sparkline-row sparkline-row--center-zero">
        <div className="sparkline-row__label">{label}</div>
        <div className="sparkline-row__bars">
          <div className="sparkline-row__zero-line" />
          {data.map((v, i) => {
            const isNull = v == null;
            const pct = isNull ? 0 : Math.min(Math.abs(v) / absMax, 1) * 45;
            const isNeg = v != null && v < 0;
            const bg = isNeg ? negativeColor : positiveColor;
            const selected = selectedIndex === i;
            return (
              <div
                key={i}
                className={`sparkline-row__col${selected ? ' sparkline-row__col--selected' : ''}`}
                onClick={() => onColumnClick?.(i)}
              >
                {isNull ? (
                  <div className="sparkline-row__bar sparkline-row__bar--empty" />
                ) : isNeg ? (
                  <div className="sparkline-row__bar sparkline-row__bar--neg" style={{ height: `${pct}%`, background: bg }} />
                ) : (
                  <div className="sparkline-row__bar sparkline-row__bar--pos" style={{ height: `${pct}%`, background: bg }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="sparkline-row">
      <div className="sparkline-row__label">{label}</div>
      <div className="sparkline-row__bars">
        {data.map((v, i) => {
          const isNull = v == null;
          const pct = isNull ? 0 : Math.max(4, (v / absMax) * 100);
          const barColor = highlightFn && highlightFn(v) ? (highlightColor || color) : color;
          const selected = selectedIndex === i;
          return (
            <div
              key={i}
              className={`sparkline-row__col${selected ? ' sparkline-row__col--selected' : ''}`}
              onClick={() => onColumnClick?.(i)}
            >
              <div
                className={`sparkline-row__bar${isNull ? ' sparkline-row__bar--empty' : ''}`}
                style={isNull ? {} : { height: `${pct}%`, background: barColor }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
