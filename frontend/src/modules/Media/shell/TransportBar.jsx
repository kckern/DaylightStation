// frontend/src/modules/Media/shell/TransportBar.jsx
// Transport controls bound to any session controller — used by Now Playing
// (local). Two rows: primary (prev · rew 10s · play/pause · ffw 10s · next)
// and secondary (shuffle · repeat · speed · volume · stop). Every command is
// issued through the selected session controller. The optional command adapter
// lets Peek retain its pending-state policy without creating a second surface.
import React, { useEffect, useRef, useState } from 'react';
import {
  IconPlayerPlayFilled,
  IconPlayerPauseFilled,
  IconPlayerStopFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconRewindBackward10,
  IconRewindForward10,
  IconArrowsShuffle,
  IconRepeat,
  IconRepeatOnce,
  IconVolume,
} from '@tabler/icons-react';
import { useSessionController } from '../controller/useSessionController.js';
import { playbackRateLabel } from './stateCopy.js';
import './NowPlaying.scss';

const PLAYING_STATES = new Set(['playing', 'buffering']);
const REPEAT_NEXT = { off: 'all', all: 'one', one: 'off' };
const REPEAT_LABEL = { off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' };
const SKIP_STEP_S = 10;
const VOLUME_STEP = 10;
// 1× → 1.25× → 1.5× → 2× → 0.75× → 1×
const RATE_CYCLE = [1, 1.25, 1.5, 2, 0.75];

// A transport timeout is ambiguous: the receiver may have acted after the
// sender stopped waiting. Only the backend's explicit liveness rejection is
// affirmative evidence that nothing was published for this command.
function commandFailureCopy(error) {
  return error?.code === 'DEVICE_OFFLINE' || /\bDEVICE_OFFLINE\b/.test(String(error?.message ?? error))
    ? 'Not sent — device is offline'
    : 'Could not confirm change';
}

function nextRate(rate) {
  const idx = RATE_CYCLE.indexOf(rate);
  return RATE_CYCLE[(idx + 1) % RATE_CYCLE.length] ?? 1;
}

export function TransportBar({ target, snapshot: snapshotOverride = null, onCommand = null, pendingActions = {}, targetLabel = null, availability = null }) {
  const session = useSessionController(target);
  const snapshot = snapshotOverride ?? session.snapshot;
  const { transport, config, capabilities } = session;
  const [commandFeedback, setCommandFeedback] = useState(null);
  const commandGeneration = useRef(0);
  const targetKey = target === 'local' ? 'local' : target?.deviceId ?? 'unknown';
  const targetGeneration = useRef(0);
  const activeTargetKey = useRef(targetKey);
  // A rejection can arrive in the same commit that changes target, before an
  // effect has had a chance to run. Advance the generation during render as
  // well so an old target can never write feedback into the new surface.
  if (activeTargetKey.current !== targetKey) {
    activeTargetKey.current = targetKey;
    targetGeneration.current += 1;
    commandGeneration.current += 1;
  }
  useEffect(() => {
    setCommandFeedback(null);
  }, [targetKey]);

  const currentItem = snapshot?.currentItem ?? null;
  const queueItems = snapshot?.queue?.items ?? [];
  const hasReadyQueue = !currentItem && queueItems.length > 0;
  const hasPlayableItem = !!currentItem || hasReadyQueue;
  const isPlaying = PLAYING_STATES.has(snapshot?.state);
  const shuffle = !!snapshot?.config?.shuffle;
  const repeat = snapshot?.config?.repeat ?? 'off';
  const volume = snapshot?.config?.volume ?? 100;
  const rate = snapshot?.config?.playbackRate ?? 1;
  const canSetRate = typeof config.setPlaybackRate === 'function';
  const controlsAvailable = availability?.available !== false;
  const unavailableReason = availability?.reason ?? 'Playback controls are unavailable for this screen';

  const items = queueItems;
  const currentIndex = snapshot?.queue?.currentIndex ?? -1;
  // Neighbor checks mirror advancement.js: skipPrev never wraps; skipNext
  // wraps only under repeat='all'.
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0
    && (currentIndex < items.length - 1 || (repeat === 'all' && items.length > 1));

  const isLive = capabilities?.live === true || currentItem?.isLive === true;
  const showSeek = !!currentItem && !isLive;
  const canSeek = !!capabilities?.seekable;
  const seekUnavailableReason = capabilities?.reason ?? 'Seeking is not available for this playback';

  const runCommand = (action, operation) => {
    // Disabled controls are the normal UI boundary; retain this guard for
    // synthetic events and delayed callbacks while a target is unavailable.
    if (!controlsAvailable) return;
    const operationGeneration = ++commandGeneration.current;
    const operationTargetGeneration = targetGeneration.current;
    setCommandFeedback(null);
    const reportFailure = (error) => {
      if (commandGeneration.current === operationGeneration
        && targetGeneration.current === operationTargetGeneration) {
        setCommandFeedback(commandFailureCopy(error));
      }
    };
    let pending;
    try {
      pending = onCommand ? onCommand(action, operation) : operation();
    } catch (error) {
      reportFailure(error);
      return;
    }
    if (pending && typeof pending.catch === 'function') {
      pending.catch(reportFailure);
    }
  };
  const isPending = (action) => pendingActions?.[action] === true;
  const setVolume = (next) => runCommand('setVolume', () => config.setVolume?.(
    Math.max(0, Math.min(100, Math.round(next)))
  ));

  return (
    <div className="np-transport" data-testid="np-transport">
      {targetLabel && <div className="np-target-label" data-testid="np-target-label">{targetLabel}</div>}
      <div className="np-transport-main">
        <button
          type="button"
          data-testid="np-prev"
          className="np-icon-btn"
          aria-label="Previous"
          disabled={!controlsAvailable || !hasPrev || isPending('skipPrev')}
          onClick={() => runCommand('skipPrev', () => transport.skipPrev?.())}
        >
          <IconPlayerSkipBackFilled size={22} />
        </button>
        {showSeek && (
          <button
            type="button"
            data-testid="np-rew"
            className="np-icon-btn"
            aria-label="Back 10 seconds"
          disabled={!controlsAvailable || !canSeek || isPending('seekRel')}
          onClick={() => runCommand('seekRel', () => transport.seekRel?.(-SKIP_STEP_S))}
          >
            <IconRewindBackward10 size={22} />
          </button>
        )}
        <button
          type="button"
          data-testid="np-toggle"
          className="np-icon-btn np-icon-btn--primary"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          disabled={!controlsAvailable || !hasPlayableItem || typeof (isPlaying ? transport.pause : transport.play) !== 'function' || isPending(isPlaying ? 'pause' : 'play')}
          onClick={() => runCommand(isPlaying ? 'pause' : 'play', () => (isPlaying ? transport.pause?.() : transport.play?.()))}
        >
          {isPlaying ? <IconPlayerPauseFilled size={30} /> : <IconPlayerPlayFilled size={30} />}
        </button>
        {showSeek && (
          <button
            type="button"
            data-testid="np-ffw"
            className="np-icon-btn"
            aria-label="Forward 10 seconds"
          disabled={!controlsAvailable || !canSeek || isPending('seekRel')}
          onClick={() => runCommand('seekRel', () => transport.seekRel?.(SKIP_STEP_S))}
          >
            <IconRewindForward10 size={22} />
          </button>
        )}
        <button
          type="button"
          data-testid="np-next"
          className="np-icon-btn"
          aria-label="Next"
          disabled={!controlsAvailable || !hasNext || isPending('skipNext')}
          onClick={() => runCommand('skipNext', () => transport.skipNext?.())}
        >
          <IconPlayerSkipForwardFilled size={22} />
        </button>
      </div>

      {!!currentItem && !canSeek && (
        <div className="np-control-unavailable" role="status">{seekUnavailableReason}</div>
      )}

      <div className="np-transport-secondary">
        <button
          type="button"
          data-testid="np-shuffle"
          className={`np-icon-btn ${shuffle ? 'np-icon-btn--on' : ''}`}
          aria-label="Shuffle"
          aria-pressed={shuffle}
          disabled={!controlsAvailable || typeof config.setShuffle !== 'function'}
          onClick={() => runCommand('setShuffle', () => config.setShuffle?.(!shuffle))}
        >
          <IconArrowsShuffle size={20} />
        </button>
        <button
          type="button"
          data-testid="np-repeat"
          className={`np-icon-btn ${repeat !== 'off' ? 'np-icon-btn--on' : ''}`}
          aria-label={REPEAT_LABEL[repeat] ?? 'Repeat off'}
          disabled={!controlsAvailable || typeof config.setRepeat !== 'function'}
          onClick={() => runCommand('setRepeat', () => config.setRepeat?.(REPEAT_NEXT[repeat]))}
        >
          {repeat === 'one' ? <IconRepeatOnce size={20} /> : <IconRepeat size={20} />}
        </button>
        <button
          type="button"
          data-testid="np-rate"
          className={`np-rate-btn ${rate !== 1 ? 'np-rate-btn--engaged' : ''}`}
          aria-label={`Playback speed: ${playbackRateLabel(rate)}`}
          disabled={!controlsAvailable || !canSetRate || isPending('setPlaybackRate')}
          onClick={() => runCommand('setPlaybackRate', () => config.setPlaybackRate?.(nextRate(rate)))}
        >
          {playbackRateLabel(rate)}
        </button>
        {controlsAvailable && !canSetRate && <div className="np-control-unavailable" role="status">Playback speed is not available for this screen</div>}
        <span className="np-volume-group">
          <IconVolume size={18} aria-hidden="true" />
          <button
            type="button"
            className="np-volume-step"
            aria-label="Decrease volume"
            disabled={!controlsAvailable || typeof config.setVolume !== 'function' || volume <= 0 || isPending('setVolume')}
            onClick={() => setVolume(volume - VOLUME_STEP)}
          >
            −
          </button>
          <input
            type="range"
            data-testid="np-volume"
            className="np-volume"
            min={0}
            max={100}
            step={1}
            value={volume}
            aria-label="Volume"
            disabled={!controlsAvailable || typeof config.setVolume !== 'function'}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
          <span className="np-volume-level" data-testid="np-volume-level">{volume}%</span>
          <button
            type="button"
            className="np-volume-step"
            aria-label="Increase volume"
            disabled={!controlsAvailable || typeof config.setVolume !== 'function' || volume >= 100 || isPending('setVolume')}
            onClick={() => setVolume(volume + VOLUME_STEP)}
          >
            +
          </button>
        </span>
        <button
          type="button"
          data-testid="np-stop"
          className="np-icon-btn"
          aria-label="Stop"
          disabled={!controlsAvailable || typeof transport.stop !== 'function' || isPending('stop')}
          onClick={() => runCommand('stop', () => transport.stop?.())}
        >
          <IconPlayerStopFilled size={20} />
        </button>
      </div>
      {(!controlsAvailable || !hasPlayableItem) && (
        <div className="np-control-unavailable" role="status">{unavailableReason}</div>
      )}
      {commandFeedback && <div className="np-command-feedback" data-testid="np-command-feedback" role="status">{commandFeedback}</div>}
    </div>
  );
}

export default TransportBar;
