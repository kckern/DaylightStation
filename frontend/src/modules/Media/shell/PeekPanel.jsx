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

  const stateLabel = snap?.state ?? 'unknown';
  const itemLabel = snap?.currentItem?.title ?? snap?.currentItem?.contentId ?? 'nothing';
  const volume = snap?.config?.volume ?? 50;

  return (
    <div data-testid="peek-panel" className="peek-panel">
      <h2>Peek: {deviceId}</h2>
      <div>state: {stateLabel}</div>
      <div>item: {itemLabel}</div>
      <div className="peek-transport">
        <button data-testid="peek-play" onClick={ctl.transport.play}>Play</button>
        <button data-testid="peek-pause" onClick={ctl.transport.pause}>Pause</button>
        <button data-testid="peek-stop" onClick={ctl.transport.stop}>Stop</button>
        <button data-testid="peek-next" onClick={ctl.transport.skipNext}>Next</button>
        <button data-testid="peek-prev" onClick={ctl.transport.skipPrev}>Prev</button>
      </div>
      <div className="peek-config">
        <label>
          Volume: {volume}
          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            onChange={(e) => ctl.config.setVolume(Number(e.target.value))}
            data-testid="peek-volume"
          />
        </label>
      </div>
    </div>
  );
}

export default PeekPanel;
