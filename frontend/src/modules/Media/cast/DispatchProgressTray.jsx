import React from 'react';
import { useDispatch } from './useDispatch.js';

function statusLabel(d) {
  if (d.status === 'running') {
    const last = d.steps[d.steps.length - 1];
    return last ? `running: ${last.step} (${last.status})` : 'running';
  }
  if (d.status === 'success') {
    return `success (${d.totalElapsedMs ?? 0}ms)`;
  }
  if (d.status === 'failed') {
    return `failed: ${d.failedStep ?? 'unknown'} — ${d.error}`;
  }
  return d.status;
}

export function DispatchProgressTray() {
  const { dispatches, retryLast } = useDispatch();
  if (dispatches.size === 0) return null;
  return (
    <div data-testid="dispatch-tray" className="dispatch-tray">
      {[...dispatches.values()].map((d) => (
        <div key={d.dispatchId} data-testid={`dispatch-row-${d.dispatchId}`} className="dispatch-row">
          <span className="dispatch-row-device">{d.deviceId}</span>
          <span className="dispatch-row-content">{d.contentId}</span>
          <span className="dispatch-row-status">{statusLabel(d)}</span>
          {d.status === 'failed' && (
            <button
              data-testid={`dispatch-retry-${d.dispatchId}`}
              onClick={retryLast}
              className="dispatch-row-retry"
            >
              Retry
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export default DispatchProgressTray;
