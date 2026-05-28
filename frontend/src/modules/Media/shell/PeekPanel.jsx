import React, { useEffect, useMemo } from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { usePeek } from '../peek/usePeek.js';
import { useStatusOverlay } from '../../../hooks/useStatusOverlay';

/**
 * PeekPanel — remote-control surface for a single device.
 *
 * Interstitial state: every transport command takes a network round-trip
 * (~200ms HTTP + WS ACK) before the device-state WS topic reflects the
 * change. Without optimistic state the UI looks frozen between click and
 * confirmation. We overlay the predicted snapshot via useStatusOverlay so
 * the visible state flips immediately while the affected control greys +
 * locks until the real WS update catches up (or 5s timeout).
 *
 * Field map:
 *   state          (string)  - play/pause/stop predict against this
 *   currentItem    (object)  - skipNext/skipPrev pending lock on this
 *   config.volume  (number)  - left as-is for now; nested patch needs a
 *                              deep-merge variant of the overlay hook
 */
export function PeekPanel({ deviceId }) {
  const { enterPeek, exitPeek } = usePeek();
  useEffect(() => {
    enterPeek(deviceId);
    return () => exitPeek(deviceId);
  }, [deviceId, enterPeek, exitPeek]);

  const ctl = useSessionController({ deviceId });
  const realSnap = ctl.snapshot;

  // useStatusOverlay is map-based (so it can serve multi-device admins).
  // PeekPanel has exactly one device, so wrap in a one-entry Map.
  const realMap = useMemo(
    () => new Map([[deviceId, realSnap ?? {}]]),
    [deviceId, realSnap],
  );
  const { statusView, predict, pending } = useStatusOverlay(realMap);
  const snap = statusView.get(deviceId);

  const stateLabel = snap?.state ?? 'unknown';
  const itemLabel = snap?.currentItem?.title ?? snap?.currentItem?.contentId ?? 'nothing';
  const volume = snap?.config?.volume ?? 50;
  const pendingFields = snap?._pending;

  const statePending = pendingFields?.has('state');
  const currentItemPending = pendingFields?.has('currentItem');

  const handlePlay = () => {
    predict(deviceId, { state: 'playing' });
    ctl.transport.play?.();
  };
  const handlePause = () => {
    predict(deviceId, { state: 'paused' });
    ctl.transport.pause?.();
  };
  const handleStop = () => {
    predict(deviceId, { state: 'stopped' });
    ctl.transport.stop?.();
  };
  const handleNext = () => {
    pending(deviceId, ['currentItem']);
    ctl.transport.skipNext?.();
  };
  const handlePrev = () => {
    pending(deviceId, ['currentItem']);
    ctl.transport.skipPrev?.();
  };

  return (
    <div data-testid="peek-panel" className="peek-panel">
      <h2>Peek: {deviceId}</h2>
      <div data-pending={statePending ? 'true' : undefined}>state: {stateLabel}</div>
      <div data-pending={currentItemPending ? 'true' : undefined}>item: {itemLabel}</div>
      <div className="peek-transport">
        <button
          data-testid="peek-play"
          onClick={handlePlay}
          disabled={statePending}
          data-pending={statePending ? 'true' : undefined}
        >
          Play
        </button>
        <button
          data-testid="peek-pause"
          onClick={handlePause}
          disabled={statePending}
          data-pending={statePending ? 'true' : undefined}
        >
          Pause
        </button>
        <button
          data-testid="peek-stop"
          onClick={handleStop}
          disabled={statePending}
          data-pending={statePending ? 'true' : undefined}
        >
          Stop
        </button>
        <button
          data-testid="peek-next"
          onClick={handleNext}
          disabled={currentItemPending}
          data-pending={currentItemPending ? 'true' : undefined}
        >
          Next
        </button>
        <button
          data-testid="peek-prev"
          onClick={handlePrev}
          disabled={currentItemPending}
          data-pending={currentItemPending ? 'true' : undefined}
        >
          Prev
        </button>
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
