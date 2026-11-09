import React from 'react';

// Standard-mapping indices, laid out like a pad (positions, not printed letters).
const FACE = [[0, 150, 52], [1, 164, 38], [2, 136, 38], [3, 150, 24]];
const DPAD = [[12, 50, 26, 10, 12], [13, 50, 50, 10, 12], [14, 36, 38, 12, 10], [15, 62, 38, 12, 10]];

/**
 * A controller outline whose buttons light as they are pressed. Sticks show as
 * a dot that moves with the axes — which is also where pads that report the
 * D-pad on the left stick (the SFC30) light up.
 */
export default function PadDiagram({ pressed = [], axes = [] }) {
  const on = (i) => (pressed[i] ? ' is-on' : '');
  const [lx = 0, ly = 0, rx = 0, ry = 0] = axes;
  return <svg className="pad-diagram" viewBox="0 0 200 84" aria-hidden="true">
    <rect className={`pad-diagram__shoulder${on(4) || on(6)}`} x="22" y="2" width="44" height="8" rx="4" />
    <rect className={`pad-diagram__shoulder${on(5) || on(7)}`} x="134" y="2" width="44" height="8" rx="4" />
    <rect className="pad-diagram__body" x="6" y="8" width="188" height="72" rx="34" />
    <rect className="pad-diagram__dpad-base" x="36" y="26" width="38" height="36" rx="4" />
    {DPAD.map(([i, x, y, w, h]) => <rect key={i} className={`pad-diagram__btn${on(i)}`} x={x} y={y} width={w} height={h} rx="2" />)}
    {FACE.map(([i, cx, cy]) => <circle key={i} className={`pad-diagram__btn${on(i)}`} cx={cx} cy={cy} r="8" />)}
    <rect className={`pad-diagram__btn${on(8)}`} x="82" y="30" width="16" height="6" rx="3" />
    <rect className={`pad-diagram__btn${on(9)}`} x="102" y="30" width="16" height="6" rx="3" />
    <circle className={`pad-diagram__stick${on(10)}`} cx="80" cy="62" r="9" />
    <circle className={`pad-diagram__btn${lx || ly ? ' is-on' : ''}`} cx={80 + lx * 5} cy={62 + ly * 5} r="4" />
    <circle className={`pad-diagram__stick${on(11)}`} cx="120" cy="62" r="9" />
    <circle className={`pad-diagram__btn${rx || ry ? ' is-on' : ''}`} cx={120 + rx * 5} cy={62 + ry * 5} r="4" />
  </svg>;
}
