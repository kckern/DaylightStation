import React from 'react';

// Everything that can cover the flight scene: the crash hold, the wait for the
// first pedal stroke, a lost cadence sensor and the stall notice.
export default function SkylineFlightOverlays({ flight }) {
  return <>
    {flight.phase === 'crashed' && <div className="skyline-glider__overlay"><h2>{flight.crashCause === 'stall' ? 'Stall!' : 'Wing down!'}</h2><p>Returning to the last windsock…</p></div>}
    {!flight.inputReady && <div className="skyline-glider__overlay" data-testid="skyline-glider-waiting-input"><h2>Ready to fly</h2><p>Pedal once to start the course.</p></div>}
    {flight.inputReady && flight.pausedForSensor && <div className="skyline-glider__overlay" data-testid="skyline-glider-reconnect"><h2>Cadence signal lost</h2><p>Reconnect the bike to continue safely.</p></div>}
    {flight.stalled && flight.phase === 'playing' && <div className="skyline-glider__stop-warning" role="status">Stalled! Returning to the checkpoint…</div>}
  </>;
}
