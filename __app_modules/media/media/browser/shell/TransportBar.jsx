// shell/TransportBar.jsx
// The one control bar bound to any session controller — Now Playing (this
// device) and a screen's Remote (Peek). Now Playing ruling (2026-11-27): one
// row in three zones, aligned to the picture's edges —
//   lead:   what plays (title and subtitle), when the caller passes it;
//   centre: prev · back 10 s · play/pause (amber) · forward 10 s · next;
//   end:    volume (slider on a pointer device, −/+ on touch, never both) ·
//           subtitles/audio · ⚙ (Speed, then the caller's settings) ·
//           Play on… (the caller's) · More ⋯ (Stop, then the caller's items).
// Every command is issued through the selected session controller. The
// optional command adapter lets Peek retain its pending-state policy without
// creating a second surface.
import React, { useEffect, useRef, useState } from 'react';
import { ActionIcon, Menu, Tooltip, UnstyledButton } from '@mantine/core';
import {
  IconDots,
  IconMinus,
  IconPlus,
  IconPlayerStopFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconRewindBackward10,
  IconRewindForward10,
  IconSettings,
  IconVolume,
} from '@tabler/icons-react';
import { UiIcon } from '@/lib/ui/UiIcon.jsx';
import { ActionMenu } from '@/lib/ui/ActionMenu.jsx';
import { useSessionController } from "../controller/useSessionController.js";
import { commandFailureCopy, playbackRateLabel } from "./stateCopy.js";
import { PlayerFeatureControls, TrackButtons, useSlideshowStopGuard } from "./PlayerFeatureControls.jsx";
import mediaLog from "../logging/mediaLog.js";
import "./NowPlaying.scss";

const PLAYING_STATES = new Set(['playing', 'buffering']);
const SKIP_STEP_S = 10;
const VOLUME_STEP = 10;
// 1× → 1.25× → 1.5× → 2× → 0.75× → 1×
const RATE_CYCLE = [1, 1.25, 1.5, 2, 0.75];

function nextRate(rate) {
  const idx = RATE_CYCLE.indexOf(rate);
  return RATE_CYCLE[(idx + 1) % RATE_CYCLE.length] ?? 1;
}

/** True on a touch-first device (pointer: coarse), where drags are unreliable. */
export function useCoarsePointer() {
  const query = '(pointer: coarse)';
  const read = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches : false);
  const [coarse, setCoarse] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const onChange = () => setCoarse(list.matches);
    list.addEventListener?.('change', onChange);
    return () => list.removeEventListener?.('change', onChange);
  }, []);
  return coarse;
}

/**
 * Volume (owner ruling 2026-11-27): a short slider on a pointer device, −/+
 * steps on touch — never both on one device. The level is a tooltip and an
 * aria value, never a printed number in the bar.
 */
function VolumeControl({ volume, disabled, stepDisabled, onSet, coarse }) {
  const label = `${volume}%`;
  const level = <span className="media-sr-only" data-testid="np-volume-level">{label}</span>;
  if (!coarse) {
    return (
      <Tooltip label={`Volume ${label}`} withinPortal>
        <span className="np-volume-group np-volume-group--slider">
          <IconVolume size={18} aria-hidden="true" className="np-volume-icon" />
          <input
            type="range"
            data-testid="np-volume"
            className="np-volume"
            min={0}
            max={100}
            step={1}
            value={volume}
            aria-label="Volume"
            aria-valuetext={label}
            disabled={disabled}
            style={{ '--np-volume-fill': `${volume}%` }}
            onChange={(e) => onSet(Number(e.target.value))}
          />
          {level}
        </span>
      </Tooltip>
    );
  }
  return (
    <span className="np-volume-group np-volume-group--steps" role="group" aria-label="Volume" data-testid="np-volume" title={`Volume ${label}`}>
      <ActionIcon
        className="np-volume-step"
        variant="subtle"
        color="gray"
        size={44}
        aria-label="Decrease volume"
        disabled={disabled || stepDisabled || volume <= 0}
        onClick={() => onSet(volume - VOLUME_STEP)}
      >
        <IconMinus size={18} />
      </ActionIcon>
      <IconVolume size={18} aria-hidden="true" className="np-volume-icon" />
      {level}
      <ActionIcon
        className="np-volume-step"
        variant="subtle"
        color="gray"
        size={44}
        aria-label="Increase volume"
        disabled={disabled || stepDisabled || volume >= 100}
        onClick={() => onSet(volume + VOLUME_STEP)}
      >
        <IconPlus size={18} />
      </ActionIcon>
    </span>
  );
}

/**
 * The bar. `lead` (title block), `playOn` (the caller's Play on… / Move to…),
 * `moreItems` (Menu items after Stop) and `trailing` (e.g. Shrink) are
 * optional slots, so this device and a screen share one layout.
 */
export function TransportBar({
  target, snapshot: snapshotOverride = null, onCommand = null, pendingActions = {}, targetLabel = null,
  availability = null, lead = null, playOn = null, moreItems = null, settingsItems = null, trailing = null,
  seekReason = true,
}) {
  const coarse = useCoarsePointer();
  const session = useSessionController(target);
  const snapshot = snapshotOverride ?? session.snapshot;
  const { transport, config, capabilities } = session;
  const [commandFeedback, setCommandFeedback] = useState(null);
  const [guardStop, stopGuardDialog] = useSlideshowStopGuard(target, snapshotOverride);
  const commandGeneration = useRef(0);
  const targetKey = target === 'local' ? 'local' : target?.deviceId ?? 'unknown';
  const targetGeneration = useRef(0);
  const activeTargetKey = useRef(targetKey);
  const moreRef = useRef(null);
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
  const repeat = snapshot?.config?.repeat ?? 'off';
  const volume = snapshot?.config?.volume ?? 100;
  const rate = snapshot?.config?.playbackRate ?? 1;
  const speedCapability = capabilities?.speed;
  const canSetRate = typeof config.setPlaybackRate === 'function'
    && speedCapability?.available !== false;
  const speedUnavailableReason = speedCapability?.reason
    ?? 'Playback speed is not available for this screen';
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
  const volumeDisabled = !controlsAvailable || typeof config.setVolume !== 'function';
  const stopDisabled = !controlsAvailable || typeof transport.stop !== 'function' || isPending('stop');
  const speedReasonId = `np-rate-reason-${targetKey}`;

  return (
    <div className="np-transport" data-testid="np-transport">
      {targetLabel && <span className="media-sr-only" data-testid="np-target-label">{targetLabel}</span>}
      <div className={`np-bar${lead ? ' np-bar--lead' : ''}`}>
        {lead && <div className="np-bar-lead">{lead}</div>}
        <div className="np-bar-centre" role="group" aria-label="Playback">
          <UnstyledButton
            data-testid="np-prev"
            className="np-icon-btn"
            aria-label="Previous"
            disabled={!controlsAvailable || !hasPrev || isPending('skipPrev')}
            onClick={() => runCommand('skipPrev', () => transport.skipPrev?.())}
          >
            <IconPlayerSkipBackFilled size={20} />
          </UnstyledButton>
          {showSeek && (
            <UnstyledButton
              data-testid="np-rew"
              className="np-icon-btn"
              aria-label="Back 10 seconds"
              disabled={!controlsAvailable || !canSeek || isPending('seekRel')}
              onClick={() => runCommand('seekRel', () => transport.seekRel?.(-SKIP_STEP_S))}
            >
              <IconRewindBackward10 size={20} />
            </UnstyledButton>
          )}
          <UnstyledButton
            data-testid="np-toggle"
            className="np-icon-btn np-icon-btn--primary"
            aria-label={isPlaying ? 'Pause' : 'Play'}
            disabled={!controlsAvailable || !hasPlayableItem || typeof (isPlaying ? transport.pause : transport.play) !== 'function' || isPending(isPlaying ? 'pause' : 'play')}
            onClick={() => runCommand(isPlaying ? 'pause' : 'play', () => (isPlaying ? transport.pause?.() : transport.play?.()))}
          >
            <UiIcon name={isPlaying ? 'pause' : 'play'} size={26} />
          </UnstyledButton>
          {showSeek && (
            <UnstyledButton
              data-testid="np-ffw"
              className="np-icon-btn"
              aria-label="Forward 10 seconds"
              disabled={!controlsAvailable || !canSeek || isPending('seekRel')}
              onClick={() => runCommand('seekRel', () => transport.seekRel?.(SKIP_STEP_S))}
            >
              <IconRewindForward10 size={20} />
            </UnstyledButton>
          )}
          <UnstyledButton
            data-testid="np-next"
            className="np-icon-btn"
            aria-label="Next"
            disabled={!controlsAvailable || !hasNext || isPending('skipNext')}
            onClick={() => runCommand('skipNext', () => transport.skipNext?.())}
          >
            <IconPlayerSkipForwardFilled size={20} />
          </UnstyledButton>
        </div>

        <div className="np-bar-end">
          {/* Speed is rare: it lives in the ⚙ menu; the bar shows it only when it is not 1×. */}
          {rate !== 1 && <span className="np-rate-chip" data-testid="np-rate-chip">{playbackRateLabel(rate)}</span>}
          <VolumeControl volume={volume} disabled={volumeDisabled} stepDisabled={isPending('setVolume')} onSet={setVolume} coarse={coarse} />
          <TrackButtons target={target} snapshot={snapshotOverride} />
          <ActionMenu
            position="top-end"
            withinPortal={false}
            shadow="md"
            dropdownProps={{ 'data-testid': 'np-settings-menu', className: 'np-more-menu' }}
            trigger={
              <ActionIcon
                data-testid="np-settings"
                className="np-icon-btn"
                variant="default"
                size={44}
                radius="xl"
                aria-label="Playback settings"
                title="Playback settings"
              >
                <IconSettings size={20} />
              </ActionIcon>
            }
          >
            <Menu.Item
              data-testid="np-rate"
              className="np-more-explained"
              aria-label={`Playback speed: ${playbackRateLabel(rate)}`}
              aria-describedby={controlsAvailable && !canSetRate ? speedReasonId : undefined}
              closeMenuOnClick={false}
              disabled={!controlsAvailable || !canSetRate || isPending('setPlaybackRate')}
              rightSection={<span className="np-menu-aside">{playbackRateLabel(rate)}</span>}
              onClick={() => runCommand('setPlaybackRate', () => config.setPlaybackRate?.(nextRate(rate)))}
            >
              <span className="np-more-label">Speed</span>
              {controlsAvailable && !canSetRate && (
                <span id={speedReasonId} className="np-more-explain np-control-unavailable">{speedUnavailableReason}</span>
              )}
            </Menu.Item>
            {settingsItems}
          </ActionMenu>
          {playOn}
          <ActionMenu
            position="top-end"
            withinPortal={false}
            shadow="md"
            dropdownProps={{ 'data-testid': 'np-more-menu', className: 'np-more-menu' }}
            trigger={
              <ActionIcon
                ref={moreRef}
                data-testid="np-more"
                className="np-icon-btn"
                variant="default"
                size={44}
                radius="xl"
                aria-label="More"
                title="More"
                onClick={() => mediaLog.nowPlayingMoreOpened?.({ target: targetKey })}
              >
                <IconDots size={20} />
              </ActionIcon>
            }
          >
            <Menu.Item
              data-testid="np-stop"
              aria-label="Stop"
              leftSection={<IconPlayerStopFilled size={16} />}
              disabled={stopDisabled}
              onClick={() => guardStop((opts) => runCommand('stop', () => transport.stop?.(opts)), moreRef.current)}
            >
              Stop
            </Menu.Item>
            {moreItems && <Menu.Divider />}
            {moreItems}
          </ActionMenu>
          {trailing}
        </div>
      </div>

      {/* The seek bar says it itself where one is shown (seekReason=false): never twice. */}
      {(seekReason || isLive) && !!currentItem && !canSeek && (
        <div className="np-control-unavailable" role="status">{seekUnavailableReason}</div>
      )}
      {(!controlsAvailable || !hasPlayableItem) && (
        <div className="np-control-unavailable" role="status">{unavailableReason}</div>
      )}
      {commandFeedback && <div className="np-command-feedback" data-testid="np-command-feedback" role="status">{commandFeedback}</div>}
      <PlayerFeatureControls target={target} snapshot={snapshotOverride} withTracks={false} />
      {stopGuardDialog}
    </div>
  );
}

export default TransportBar;
