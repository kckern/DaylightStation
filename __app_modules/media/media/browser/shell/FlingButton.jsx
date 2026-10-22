// __app_modules/media/media/browser/shell/FlingButton.jsx
// Fling: the local player is a staging area. While something plays here, the
// handle (MiniPlayer) and the local transport offer "Play on a screen": pick a
// screen and the SAME item starts there, with no search and no menus.
//
// It is the existing local hand-off (cast/useHandOff.js, transfer mode), not a
// second dispatch: the screen adopts first (typed hand-off, or the adopt load
// that wakes an idle screen — cast/screenMove.js), and only then is playback
// here stopped, and only if it is still the same item. A fling that does not
// confirm leaves this device playing and says so.
//
// The screen starts from the beginning. Past 10% of the item (cast/flingStart.js)
// the panel also offers "Start where I am (m:ss)"; the beginning stays first
// and selected.
import React, { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Popover, UnstyledButton } from '@mantine/core';
import { IconCast } from '@tabler/icons-react';
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { DispatchContext } from "../cast/DispatchProvider.jsx";
import { LocalSessionContext } from "../session/LocalSessionContext.js";
import { usePlaybackPosition } from "../controller/usePlaybackPosition.js";
import { useHandOff } from "../cast/useHandOff.js";
import { flingStartChoice, flingStartAt } from "../cast/flingStart.js";
import { deviceName, deviceLocation } from "../fleet/deviceDisplay.js";
import { DeviceIcon } from "../fleet/DeviceIcon.jsx";
import { moveDestinations } from "./MoveToMenu.jsx";
import { formatTime } from "./formatTime.js";
import { useDismissLayer } from "./useDismissLayer.js";
import mediaLog from "../logging/mediaLog.js";
import "./Fling.scss";

const ACTIVE_STATES = new Set(['playing', 'paused', 'buffering', 'stalled']);
const NOOP_UNSUB = () => () => {};

function useLocalSnapshot(controller) {
  const subscribe = useCallback((cb) => (controller ? controller.subscribe(cb) : NOOP_UNSUB()), [controller]);
  const get = useCallback(() => (controller ? controller.getSnapshot() : null), [controller]);
  return useSyncExternalStore(subscribe, get, get);
}

/** Plain words for a fling that did not finish. Local playback is untouched. */
export function flingFailureCopy(result, targetName) {
  if (result?.status === 'adopted') return `Started on ${targetName}, but this device kept playing.`;
  if (result?.error === 'no-snapshot' || result?.error === 'invalid-source') return 'Nothing here can be sent right now.';
  return `${targetName} did not confirm. Still playing here.`;
}

/**
 * The fling control. Renders nothing outside the fleet / dispatch providers,
 * when nothing plays here, or when there is no screen to send to.
 * @param {{ position?: 'top-end'|'bottom-end', size?: number, variant?: 'subtle'|'outline' }} props
 *   `outline` matches the transport's round icon buttons; `subtle` the handle's.
 */
export function FlingButton(props) {
  const fleet = useContext(FleetContext);
  const outcomes = useContext(DispatchContext);
  if (!fleet || !outcomes) return null;
  return <FlingControl {...props} fleet={fleet} outcomes={outcomes} />;
}

function FlingControl({ fleet, outcomes, position: placement = 'top-end', size = 44, variant = 'subtle' }) {
  const controller = useContext(LocalSessionContext)?.controller ?? null;
  const snapshot = useLocalSnapshot(controller);
  const live = usePlaybackPosition(controller);
  const handOff = useHandOff();
  const [open, setOpen] = useState(false);
  const [startMode, setStartMode] = useState('beginning');
  const [pendingId, setPendingId] = useState(null);
  const [error, setError] = useState(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const close = useCallback(() => setOpen(false), []);
  useDismissLayer(open, close, { managed: true });

  const item = snapshot?.currentItem ?? null;
  const targets = moveDestinations(fleet.devices ?? [], null);
  const available = !!item && ACTIVE_STATES.has(snapshot?.state)
    && typeof controller?.portability?.capture === 'function'
    && targets.length > 0;

  const positionNow = Number.isFinite(live?.seconds) ? live.seconds : (snapshot?.position ?? 0);
  const { offerChoice, position: shownPosition } = flingStartChoice({
    position: positionNow,
    duration: Number(item?.duration),
    isLive: item?.isLive === true || controller?.capabilities?.live === true,
  });
  const effectiveMode = offerChoice ? startMode : 'beginning';

  // Nothing to fling any more (stopped, or the screens went away): close.
  useEffect(() => { if (!available) setOpen(false); }, [available]);

  if (!available) return null;

  const toggle = () => {
    if (open) { setOpen(false); return; }
    setStartMode('beginning');
    setError(null);
    setOpen(true);
    mediaLog.flingOpened({
      contentId: item.contentId ?? null,
      targetIds: targets.map((d) => d.id),
      position: Math.round(shownPosition),
      duration: Number.isFinite(Number(item.duration)) ? Math.round(Number(item.duration)) : null,
      offerChoice,
    });
  };

  const chooseMode = (mode) => {
    if (mode === startMode) return;
    setStartMode(mode);
    mediaLog.flingStartModeChanged({ contentId: item.contentId ?? null, startMode: mode });
  };

  const fling = async (device) => {
    if (pendingId) return;
    const targetName = deviceName(device, device.id);
    // Read the hot position at the tap itself: "where I am" is where it is now.
    const tapPosition = controller?.position?.get?.()?.seconds ?? positionNow;
    const startAt = flingStartAt(effectiveMode, tapPosition);
    const contentId = item.contentId ?? null;
    mediaLog.flingTargetChosen({ targetId: device.id, contentId, startMode: effectiveMode, startAt: Math.round(startAt) });
    setPendingId(device.id);
    setError(null);
    // One outcome in the tray, recorded like Move to… (MoveToMenu.jsx): the
    // title only. A contentId would make the tray offer Retry / Another
    // screen, which replay a plain play there — not a fling. Retrying a
    // fling is the panel itself, which stays open on failure.
    const attemptId = outcomes.recordLocal?.({
      kind: 'move', phase: 'running',
      item: { title: item.title ?? 'what was playing' },
      targetId: device.id, targetName,
    }) ?? null;
    let result;
    try {
      result = await handOff(device.id, { mode: 'transfer', startAt, play: true });
    } catch (err) {
      result = { ok: false, status: 'uncertain', error: err?.message ?? 'fling-failed' };
    }
    if (result?.ok) {
      mediaLog.flingDispatched({ targetId: device.id, contentId, startMode: effectiveMode, startAt: Math.round(startAt) });
      mediaLog.flingLocalStopped({ targetId: device.id, contentId, sourceStopped: result.sourceStopped === true });
      outcomes.resolveLocal?.(attemptId, { phase: 'confirmed' });
      if (mounted.current) { setPendingId(null); setOpen(false); }
      return;
    }
    const copy = flingFailureCopy(result, targetName);
    mediaLog.flingFailed({
      targetId: device.id, contentId, status: result?.status ?? null,
      error: result?.error ?? result?.reason ?? null, sourceStopped: result?.sourceStopped ?? false,
    });
    outcomes.resolveLocal?.(attemptId, { phase: 'failed', reason: copy });
    if (mounted.current) { setPendingId(null); setError(copy); }
  };

  return (
    <Popover
      opened={open}
      onChange={setOpen}
      position={placement}
      withinPortal
      shadow="md"
      // Keep the app's 16 px side gutter when the panel is pushed off an edge.
      middlewares={{ flip: true, shift: { padding: 16 } }}
      trapFocus
      returnFocus
    >
      <Popover.Target>
        <UnstyledButton
          data-testid="fling-button"
          className={`fling-button fling-button--${variant}${open ? ' fling-button--open' : ''}`}
          style={{ width: size, height: size }}
          aria-label="Play on a screen"
          title="Play on a screen"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
        >
          <IconCast size={20} aria-hidden />
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown data-testid="fling-panel" className="fling-panel" aria-label="Play on a screen">
        <div className="fling-heading">Play on a screen</div>
        {offerChoice && (
          <div className="fling-start" role="radiogroup" aria-label="Where it starts" data-testid="fling-start-choice">
            <button
              type="button"
              role="radio"
              aria-checked={effectiveMode === 'beginning'}
              data-testid="fling-start-beginning"
              className={`fling-start-option${effectiveMode === 'beginning' ? ' fling-start-option--on' : ''}`}
              aria-disabled={pendingId ? true : undefined}
              onClick={() => { if (!pendingId) chooseMode('beginning'); }}
            >
              Start from the beginning
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={effectiveMode === 'current'}
              data-testid="fling-start-current"
              className={`fling-start-option${effectiveMode === 'current' ? ' fling-start-option--on' : ''}`}
              aria-disabled={pendingId ? true : undefined}
              onClick={() => { if (!pendingId) chooseMode('current'); }}
            >
              Start where I am ({formatTime(shownPosition)})
            </button>
          </div>
        )}
        <div className="fling-targets" role="group" aria-label="Screens">
          {targets.map((device) => {
            const name = deviceName(device, device.id);
            const location = deviceLocation(device);
            const pending = pendingId === device.id;
            return (
              <button
                key={device.id}
                type="button"
                data-testid={`fling-target-${device.id}`}
                className={`fling-target${pending ? ' fling-target--pending' : ''}`}
                // aria-disabled, not disabled: a disabled button drops focus to
                // the page, and Escape (handled inside the panel) stops working.
                aria-disabled={pendingId ? true : undefined}
                aria-busy={pending || undefined}
                onClick={() => fling(device)}
              >
                <DeviceIcon device={device} size={20} className="fling-target-icon" />
                <span className="fling-target-text">
                  <span className="fling-target-name">{name}</span>
                  {(pending || location) && (
                    <span className="fling-target-sub">{pending ? 'Starting…' : location}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        {error && <div className="fling-error" role="alert" data-testid="fling-error">{error}</div>}
      </Popover.Dropdown>
    </Popover>
  );
}

export default FlingButton;
