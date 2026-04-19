import React, { useEffect } from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { usePeek } from '../peek/usePeek.js';

export function PeekPanel({ deviceId }) {
  const { enterPeek, exitPeek } = usePeek();
  useEffect(() => {
    enterPeek(deviceId);
    return () => exitPeek(deviceId);
  }, [deviceId, enterPeek, exitPeek]);

  const ctl = useSessionController({ deviceId });
  const snap = ctl.snapshot;

  if (!snap) return <div data-testid="peek-panel">Peek: no state for {deviceId}</div>;

  return (
    <div data-testid="peek-panel" className="peek-panel">
      <h2>Peek: {deviceId}</h2>
      <div>state: {snap.state}</div>
      <div>item: {snap.currentItem?.title ?? snap.currentItem?.contentId ?? 'nothing'}</div>
      <div className="peek-transport">
        <button data-testid="peek-play" onClick={ctl.transport.play}>Play</button>
        <button data-testid="peek-pause" onClick={ctl.transport.pause}>Pause</button>
        <button data-testid="peek-stop" onClick={ctl.transport.stop}>Stop</button>
        <button data-testid="peek-next" onClick={ctl.transport.skipNext}>Next</button>
        <button data-testid="peek-prev" onClick={ctl.transport.skipPrev}>Prev</button>
      </div>
      <div className="peek-config">
        <label>
          Volume: {snap.config?.volume ?? 50}
          <input
            type="range"
            min="0"
            max="100"
            value={snap.config?.volume ?? 50}
            onChange={(e) => ctl.config.setVolume(Number(e.target.value))}
            data-testid="peek-volume"
          />
        </label>
      </div>
    </div>
  );
}

export default PeekPanel;
