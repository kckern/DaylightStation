// frontend/src/modules/Media/cast/DispatchProgressTray.jsx
// Live dispatch progress strip (C6.3), in words a person on a couch can
// read: "Turning on TV…" → "Sent to Living Room TV" → "▶ Playing on Living
// Room TV". A row is NOT cleared the instant the load succeeds — it waits
// for the backend playback watchdog's trailing `playback` step so the user
// gets honest confirmation (or an honest "the TV may not have started
// playing"). Failures and unconfirmed playback never auto-clear; confirmed
// playback lingers briefly with a Remote shortcut. Never modal (N1.3).
import React, { useEffect } from 'react';
import { IconAlertCircle, IconRefresh, IconX, IconDeviceRemote, IconPlayerPlayFilled } from '@tabler/icons-react';
import { useDispatch } from './DispatchProvider.jsx';
import { useDevice } from '../fleet/useDevice.js';
import { deviceName } from '../fleet/deviceDisplay.js';
import { useNav } from '../shell/NavProvider.jsx';
import { friendlyStepLabel, friendlyStepPhrase } from './castCopy.js';
import './Cast.scss';

// Confirmed playback lingers long enough to be seen, then clears.
export const CONFIRMED_LINGER_MS = 8_000;
// "Sent" rows without a playback resolution eventually clear on their own:
// the backend watchdog resolves within ~90s (a 'confirmed' or 'timeout'
// broadcast), so a row still unresolved past that will never get one.
// Generous, not 3 seconds.
export const SENT_RESOLUTION_TIMEOUT_MS = 100_000;

/** Which lifecycle phase a dispatch entry is in, for rendering. */
export function rowPhase(d) {
  if (d.status === 'failed') return 'failed';
  if (d.status !== 'success') return 'running';
  if (d.playback === 'confirmed') return 'confirmed';
  if (d.playback === 'timeout') return 'unconfirmed';
  return 'sent';
}

function StatusIcon({ phase }) {
  if (phase === 'running' || phase === 'sent') {
    return <span className="cast-tray-spinner" aria-hidden />;
  }
  if (phase === 'confirmed') {
    return <IconPlayerPlayFilled size={16} className="cast-tray-icon--ok" />;
  }
  if (phase === 'unconfirmed') {
    return <IconAlertCircle size={16} className="cast-tray-icon--warn" />;
  }
  return <IconAlertCircle size={16} className="cast-tray-icon--fail" />;
}

function rowCopy(d, phase, name) {
  switch (phase) {
    case 'running': {
      const last = d.steps[d.steps.length - 1];
      return {
        primary: d.title ? `Casting ${d.title} to ${name}` : `Casting to ${name}`,
        secondary: last ? friendlyStepLabel(last.step) : 'Starting…',
      };
    }
    case 'sent':
      return { primary: `Sent to ${name}`, secondary: d.title ?? null };
    case 'confirmed':
      return { primary: `▶ Playing on ${name}`, secondary: d.title ?? null };
    case 'unconfirmed':
      return {
        primary: 'The TV may not have started playing — check it or open the remote',
        secondary: d.title ? `Sent to ${name} · ${d.title}` : `Sent to ${name}`,
      };
    case 'failed': {
      const phrase = friendlyStepPhrase(d.failedStep);
      return {
        primary: `Couldn't cast to ${name}`,
        secondary: phrase ? `Stopped while ${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}` : (d.error ?? null),
      };
    }
    default:
      return { primary: name, secondary: null };
  }
}

function TrayRow({ d, retryLast, removeDispatch }) {
  const { device } = useDevice(d.deviceId);
  const name = deviceName(device, d.deviceId);
  const { push } = useNav();
  const phase = rowPhase(d);

  // Row lifecycle: confirmed lingers briefly; "sent" clears only after the
  // watchdog window has certainly passed. Failed/unconfirmed NEVER auto-clear
  // — a problem the user hasn't seen isn't handled.
  useEffect(() => {
    if (phase !== 'confirmed' && phase !== 'sent') return undefined;
    const ms = phase === 'confirmed' ? CONFIRMED_LINGER_MS : SENT_RESOLUTION_TIMEOUT_MS;
    const t = setTimeout(() => removeDispatch(d.dispatchId), ms);
    return () => clearTimeout(t);
  }, [phase, d.dispatchId, removeDispatch]);

  const openRemote = () => {
    push('peek', { deviceId: d.deviceId });
    removeDispatch(d.dispatchId);
  };

  const { primary, secondary } = rowCopy(d, phase, name);
  const showRemote = phase === 'confirmed' || phase === 'unconfirmed';
  const dismissible = phase === 'failed' || phase === 'unconfirmed';

  return (
    <div data-testid={`dispatch-row-${d.dispatchId}`} className={`cast-tray-row cast-tray-row--${phase}`}>
      <StatusIcon phase={phase} />
      <div className="cast-tray-text">
        <span className="cast-tray-primary">{primary}</span>
        {secondary && <span className="cast-tray-secondary">{secondary}</span>}
      </div>
      {showRemote && (
        <button
          type="button"
          data-testid={`dispatch-remote-${d.dispatchId}`}
          onClick={openRemote}
          className="cast-tray-action"
        >
          <IconDeviceRemote size={14} /> Remote
        </button>
      )}
      {phase === 'failed' && (
        <button
          type="button"
          data-testid={`dispatch-retry-${d.dispatchId}`}
          onClick={retryLast}
          className="cast-tray-action"
        >
          <IconRefresh size={14} /> Retry
        </button>
      )}
      {dismissible && (
        <button
          type="button"
          data-testid={`dispatch-dismiss-${d.dispatchId}`}
          aria-label="Dismiss"
          onClick={() => removeDispatch(d.dispatchId)}
          className="cast-tray-dismiss"
        >
          <IconX size={14} />
        </button>
      )}
    </div>
  );
}

export function DispatchProgressTray() {
  const { dispatches, retryLast, removeDispatch } = useDispatch();
  if (dispatches.size === 0) return null;
  return (
    <div data-testid="dispatch-tray" className="cast-tray">
      {[...dispatches.values()].map((d) => (
        <TrayRow key={d.dispatchId} d={d} retryLast={retryLast} removeDispatch={removeDispatch} />
      ))}
    </div>
  );
}

export default DispatchProgressTray;
