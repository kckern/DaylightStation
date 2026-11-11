import React from 'react';
import { altitudeToTrackPercent } from "../../lib/skylineGlider/flightGeometry.js";

// The cadence ladder down the left edge: where the glider is, where the
// rider's current pedalling is taking it, and the rpm that does it.
export default function RpmGauge({ state }) {
  const rpm = Math.max(0, Math.round(state.rawRpm || 0));
  const altitude = altitudeToTrackPercent(state.altitude);
  const target = altitudeToTrackPercent(state.targetAltitude);
  return <aside
    className="skyline-glider__rpm-gauge"
    role="meter"
    aria-label="Cadence altitude"
    aria-valuemin={state.calibration.lowRpm}
    aria-valuemax={state.calibration.highRpm}
    aria-valuenow={rpm}
  >
    <span className="skyline-glider__rpm-high">{state.calibration.highRpm}</span>
    <div className="skyline-glider__rpm-track">
      <div className="skyline-glider__rpm-target" data-testid="rpm-target" style={{ top: `${target}%` }}/>
      <div className="skyline-glider__rpm-chevron" data-testid="rpm-chevron" data-altitude={state.altitude} style={{ top: `${altitude}%` }}><span>{rpm}</span></div>
    </div>
    <span className="skyline-glider__rpm-low">{state.calibration.lowRpm}</span>
    <strong>RPM</strong>
  </aside>;
}
