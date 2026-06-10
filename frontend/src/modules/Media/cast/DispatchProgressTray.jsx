// frontend/src/modules/Media/cast/DispatchProgressTray.jsx
// Live dispatch progress strip (C6.3): one row per in-flight dispatch with
// the current wake step; failures persist with a Retry; successes linger
// briefly then clear. Never modal — the user keeps working (N1.3).
import React, { useEffect } from 'react';
import { Loader } from '@mantine/core';
import { IconCheck, IconAlertCircle, IconRefresh } from '@tabler/icons-react';
import { useDispatch } from './DispatchProvider.jsx';
import { TIMING } from '../constants.js';

function statusLabel(d) {
  if (d.status === 'running') {
    const last = d.steps[d.steps.length - 1];
    return last ? `${last.step}…` : 'starting…';
  }
  if (d.status === 'success') return `done (${d.totalElapsedMs ?? 0}ms)`;
  if (d.status === 'failed') return `failed: ${d.failedStep ?? 'unknown'} — ${d.error}`;
  return d.status;
}

function StatusIcon({ status }) {
  if (status === 'running') return <Loader size={14} />;
  if (status === 'success') return <IconCheck size={16} color="var(--mantine-color-green-5)" />;
  return <IconAlertCircle size={16} color="var(--mantine-color-red-5)" />;
}

function TrayRow({ d, retryLast, removeDispatch }) {
  // Successful dispatches clear themselves after a short linger.
  useEffect(() => {
    if (d.status !== 'success') return undefined;
    const t = setTimeout(() => removeDispatch(d.dispatchId), TIMING.DISPATCH_TRAY_LINGER_MS);
    return () => clearTimeout(t);
  }, [d.status, d.dispatchId, removeDispatch]);

  return (
    <div data-testid={`dispatch-row-${d.dispatchId}`} className="dispatch-row">
      <StatusIcon status={d.status} />
      <span className="dispatch-row-device">{d.deviceId}</span>
      <span className="dispatch-row-content">{d.contentId}</span>
      <span className="dispatch-row-status">{statusLabel(d)}</span>
      {d.status === 'failed' && (
        <button
          data-testid={`dispatch-retry-${d.dispatchId}`}
          onClick={retryLast}
          className="dispatch-row-retry"
        >
          <IconRefresh size={14} /> Retry
        </button>
      )}
    </div>
  );
}

export function DispatchProgressTray() {
  const { dispatches, retryLast, removeDispatch } = useDispatch();
  if (dispatches.size === 0) return null;
  return (
    <div data-testid="dispatch-tray" className="dispatch-tray">
      {[...dispatches.values()].map((d) => (
        <TrayRow key={d.dispatchId} d={d} retryLast={retryLast} removeDispatch={removeDispatch} />
      ))}
    </div>
  );
}

export default DispatchProgressTray;
