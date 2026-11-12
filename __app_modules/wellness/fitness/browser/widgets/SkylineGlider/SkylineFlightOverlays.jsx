import React from 'react';

// Everything that can cover the flight scene: the crash hold, the wait for the
// first pedal stroke, a lost cadence sensor and the stall notice. Each is one
// framed window on the scene, which is left as it is (no scrim).
function Notice({ tone, title, children, testid }) {
  return <div className="skyline-glider__overlay" data-tone={tone} data-testid={testid}>
    <div className="skyline-glider__overlay-window"><h2>{title}</h2><p>{children}</p></div>
  </div>;
}

export default function SkylineFlightOverlays({ flight }) {
  return <>
    {flight.phase === 'crashed' && <Notice tone="crash" title={flight.crashCause === 'stall' ? 'Stall!' : 'Wing down!'}>Returning to the last windsock…</Notice>}
    {!flight.inputReady && <Notice tone="ready" title="Ready to fly" testid="skyline-glider-waiting-input">Pedal once to start the course.</Notice>}
    {flight.inputReady && flight.pausedForSensor && <Notice tone="warn" title="Cadence signal lost" testid="skyline-glider-reconnect">Reconnect the bike to continue safely.</Notice>}
    {flight.stalled && flight.phase === 'playing' && <div className="skyline-glider__stop-warning" role="status">Stalled! Returning to the checkpoint…</div>}
  </>;
}
