import React, { useMemo } from 'react';
import PropTypes from 'prop-types';

const USER_INTENT_LABELS = {
  playing: { icon: '▶️', label: 'Playing' },
  paused: { icon: '⏸️', label: 'Paused' },
  seeking: { icon: '⏩', label: 'Seeking' }
};

const RESILIENCE_STATUS_LABELS = {
  startup: { icon: '🟡', label: 'Startup' },
  pending: { icon: '⚪', label: 'Loading' },
  playing: { icon: '🟢', label: 'Standby' },
  paused: { icon: '⏸️', label: 'Paused' },
  stalling: { icon: '🔴', label: 'Stalling' },
  recovering: { icon: '🟠', label: 'Recovering' },
  recoveringFatal: { icon: '💥', label: 'Fatal' }
};

const SYSTEM_HEALTH_LABELS = {
  ok: { icon: '🟢', label: 'Healthy' },
  buffering: { icon: '🟡', label: 'Buffering' },
  stalled: { icon: '🔴', label: 'Stalled' },
  fatal: { icon: '💥', label: 'Fatal' }
};

const toDisplay = (map, key, fallback) => (map[key] || fallback);
const formatSeconds = (seconds) => {
  if (!Number.isFinite(seconds)) return '0:00';
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const secs = `${whole % 60}`.padStart(2, '0');
  return `${mins}:${secs}`;
};

export function PlayerOverlayStateDebug({
  userIntent,
  status,
  systemHealth,
  playbackHealth,
  seconds,
  stalled,
  waitingToPlay
}) {
    return false; // Disable for now
  const userDisplay = toDisplay(USER_INTENT_LABELS, userIntent, { icon: '❓', label: 'Unknown' });
  const statusDisplay = toDisplay(RESILIENCE_STATUS_LABELS, status, { icon: '❓', label: status || 'Unknown' });
  const healthDisplay = toDisplay(SYSTEM_HEALTH_LABELS, systemHealth, { icon: '❓', label: systemHealth || 'Unknown' });
  const bufferRunwayMs = Number.isFinite(playbackHealth?.bufferRunwayMs)
    ? Math.max(0, Math.round(playbackHealth.bufferRunwayMs))
    : null;
  const bufferLabel = bufferRunwayMs != null ? `${bufferRunwayMs} ms` : 'n/a';

  const telemetryDetails = useMemo(() => {
    if (!playbackHealth) {
      return 'no-telemetry';
    }
    const signals = playbackHealth.elementSignals || {};
    const detailBits = [
      `token:${playbackHealth.progressToken ?? 0}`,
      signals.waiting ? 'waiting' : null,
      signals.stalled ? 'stalled-event' : null,
      waitingToPlay ? 'waiting-to-play' : null,
      stalled ? 'stalling' : null,
      bufferRunwayMs != null ? `buffer:${bufferLabel}` : null
    ].filter(Boolean);
    return detailBits.length ? detailBits.join(' | ') : 'steady';
  }, [playbackHealth, waitingToPlay, stalled, bufferRunwayMs, bufferLabel]);

  return (
    <div className="player-debug-overlay" data-layer="player-debug-overlay">
      <div className="player-debug-overlay__row" data-debug-field="user">
        <span className="player-debug-overlay__label">User</span>
        <span className="player-debug-overlay__value">{userDisplay.icon} {userDisplay.label}</span>
      </div>
      <div className="player-debug-overlay__row" data-debug-field="system">
        <span className="player-debug-overlay__label">System</span>
        <span className="player-debug-overlay__value">{statusDisplay.icon} {statusDisplay.label}</span>
      </div>
      <div className="player-debug-overlay__row" data-debug-field="media">
        <span className="player-debug-overlay__label">Media</span>
        <span className="player-debug-overlay__value">{healthDisplay.icon} {healthDisplay.label}</span>
      </div>
      <div className="player-debug-overlay__row" data-debug-field="buffer">
        <span className="player-debug-overlay__label">Buffer</span>
        <span className="player-debug-overlay__value">🧠 {bufferLabel}</span>
      </div>
      <div className="player-debug-overlay__metrics">
        t={formatSeconds(seconds)} | {telemetryDetails}
      </div>
    </div>
  );
}

PlayerOverlayStateDebug.propTypes = {
  userIntent: PropTypes.string,
  status: PropTypes.string,
  systemHealth: PropTypes.string,
  playbackHealth: PropTypes.shape({
    progressToken: PropTypes.number,
    elementSignals: PropTypes.shape({
      waiting: PropTypes.bool,
      stalled: PropTypes.bool
    }),
    bufferRunwayMs: PropTypes.number
  }),
  seconds: PropTypes.number,
  stalled: PropTypes.bool,
  waitingToPlay: PropTypes.bool
};

export default PlayerOverlayStateDebug;
