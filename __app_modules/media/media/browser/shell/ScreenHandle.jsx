// frontend/src/modules/Media/shell/ScreenHandle.jsx
// The handle's other half: the session on a screen, beside this device's own
// bar (MiniPlayer.jsx). Two cases, one bar:
//
//  - Addendum item 1 (2026-11-26) — one bar follows the play. After PLAY to a
//    screen the bar reads "▶ <title> · <screen>" at once: "Starting on
//    <screen>…" while it wakes and loads, then that screen's own session
//    with pause / next / stop. A start that fails or is pre-empted says why
//    ("Office Screen didn't start", "Office Screen is now playing Bluey")
//    with Retry and Play here (item 3). The start is the DispatchProvider's
//    outcome record; the session is the screen's SessionController — the
//    same one PeekPanel binds. No second transport, no second state.
//  - STEER.1a/AC4 (RQ-STEER-01): with no start to follow, the screen this
//    device most recently steered (or aims at) while it plays, so pausing the
//    TV when the phone rings is one tap from any part of the app.
//
// Tapping the title opens that screen's full controls; the bar steps aside
// while those are open, so it never duplicates them.
import React, { useContext, useEffect, useRef } from 'react';
import { UnstyledButton } from '@mantine/core';
import {
  IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlayerSkipForwardFilled, IconPlayerStopFilled,
  IconRefresh, IconAlertCircle, IconX, IconDeviceLaptop, IconRotate,
} from '@tabler/icons-react';
import { useFleetContext } from "../fleet/useFleetContext.js";
import { useDevice } from "../fleet/useDevice.js";
import { PeekContext } from "../peek/PeekContext.js";
import { DispatchContext } from "../cast/DispatchProvider.jsx";
import { LocalSessionContext } from "../session/LocalSessionContext.js";
import { useCastTarget } from "../cast/useCastTarget.js";
import { deviceName } from "../fleet/deviceDisplay.js";
import { deviceKind, friendlyStepLabel, failureReason } from "../cast/castCopy.js";
import { executeItemAction } from "../actions/itemAction.js";
import { UndoAction } from "../cast/DispatchProgressTray.jsx";
import { useNav } from "./NavProvider.jsx";
import { presentTitle } from "../browse/tilePresentation.js";
import { pickHandleScreen, pickHandlePlay, handlePlayView } from "./screenHandleModel.js";
import { playbackStateLabel } from "./stateCopy.js";
import mediaLog from "../logging/mediaLog.js";
import "./NowPlaying.scss";

function hasNextIn(snapshot) {
  const items = Array.isArray(snapshot?.queue?.items) ? snapshot.queue.items : [];
  const index = snapshot?.queue?.currentIndex ?? -1;
  const repeat = snapshot?.config?.repeat ?? 'off';
  return index >= 0 && (index < items.length - 1 || (repeat === 'all' && items.length > 1));
}

/** pause / next / stop on the screen's own session controller. */
function SessionButtons({ deviceId, name, snapshot, controller, onStopped }) {
  const playing = snapshot?.state === 'playing' || snapshot?.state === 'buffering' || !snapshot?.state;
  const run = (action, invoke) => {
    mediaLog.screenHandleCommand({ deviceId, action });
    let result;
    try { result = invoke(); } catch (error) { result = Promise.reject(error); }
    Promise.resolve(result)
      .then(() => { if (action === 'stop') onStopped?.(); })
      .catch((error) => mediaLog.screenHandleFailed({ deviceId, action, error: error?.message ?? String(error) }));
  };
  const transport = controller?.transport ?? {};
  const hasNext = hasNextIn(snapshot);
  return (
    <>
      <UnstyledButton
        className={`np-icon-btn np-icon-btn--primary${playing ? '' : ' mini-resume'}`}
        data-testid="screen-handle-toggle"
        aria-label={playing ? `Pause ${name}` : `Resume ${name}`}
        disabled={!controller}
        onClick={() => run(playing ? 'pause' : 'play', () => (playing ? transport.pause?.() : transport.play?.()))}
      >
        {playing ? <IconPlayerPauseFilled size={20} /> : <IconPlayerPlayFilled size={18} />}
      </UnstyledButton>
      <UnstyledButton
        className={`np-icon-btn${hasNext ? '' : ' mini-next--none'}`}
        data-testid="screen-handle-next"
        aria-label={`Next on ${name}`}
        disabled={!controller || !hasNext}
        onClick={() => run('skipNext', () => transport.skipNext?.())}
      >
        <IconPlayerSkipForwardFilled size={18} />
      </UnstyledButton>
      <UnstyledButton
        className="np-icon-btn"
        data-testid="screen-handle-stop"
        aria-label={`Stop ${name}`}
        title="Stop playback and keep the queue"
        disabled={!controller}
        onClick={() => run('stop', () => transport.stop?.({ keepMusic: false }))}
      >
        <IconPlayerStopFilled size={18} />
      </UnstyledButton>
    </>
  );
}

function Bar({ deviceId, status, title, name, stateLine, onOpen, children, icon = null }) {
  return (
    <div className={`mini-player screen-handle screen-handle--${status}${status === 'failed' || status === 'preempted' ? ' mini-player--wrap' : ''}`} data-testid="screen-handle" data-device-id={deviceId} data-status={status}>
      {icon}
      <UnstyledButton
        className="mini-player-title screen-handle-open"
        data-testid="screen-handle-open"
        aria-label={`Open controls for ${name}, ${title}. ${stateLine}`}
        onClick={onOpen}
      >
        <span className="mini-player-title-stack">
          <span className="mini-player-title-text" data-testid="screen-handle-title">▶ {title} · {name}</span>
          <span className="mini-player-state" data-testid="screen-handle-state" role="status">{stateLine}</span>
        </span>
      </UnstyledButton>
      <div className="mini-player-controls">{children}</div>
    </div>
  );
}

/** Addendum items 1 and 3: the start just sent to a screen, then its session. */
function PlayBar({ record }) {
  const deviceId = record.targetId ?? record.deviceId;
  const { device, entry } = useDevice(deviceId);
  const peek = useContext(PeekContext);
  const outcomes = useContext(DispatchContext);
  const localController = useContext(LocalSessionContext)?.controller ?? null;
  const { push, view: navView, params } = useNav();
  const controller = peek?.getController?.(deviceId) ?? null;
  const snapshot = entry && !entry.offline ? entry.snapshot ?? null : null;
  const seenActiveRef = useRef(false);
  const view = handlePlayView({ record, entry, seenActive: seenActiveRef.current });
  if (view.status === 'playing' || view.status === 'paused') {
    if (snapshot?.currentItem) seenActiveRef.current = true;
  }
  const attemptId = record.attemptId ?? record.dispatchId;
  const name = deviceName(device, deviceId);
  const title = record.item?.title ?? record.title ?? presentTitle(snapshot?.currentItem) ?? 'it';

  const lastStatus = useRef(null);
  useEffect(() => {
    if (lastStatus.current === view.status) return;
    mediaLog.screenHandlePlayState({ attemptId, deviceId, status: view.status, phase: view.phase, from: lastStatus.current });
    lastStatus.current = view.status;
  }, [attemptId, deviceId, view.status, view.phase]);
  // The play is over once the screen that had it goes idle: the record has
  // nothing left to say (a failure is never cleared this way).
  useEffect(() => {
    if (view.status === 'ended') outcomes?.removeDispatch?.(attemptId);
  }, [view.status, attemptId, outcomes]);

  if (view.status === 'ended') return null;
  // Its full controls are open: do not duplicate them.
  if ((view.status === 'playing' || view.status === 'paused') && navView === 'peek' && params?.deviceId === deviceId) return null;

  const open = () => push('peek', { deviceId });
  const playHere = () => {
    const item = record.command?.itemAction?.item ?? { contentId: record.item?.contentId ?? record.contentId, title: record.item?.title ?? record.title ?? null };
    mediaLog.screenHandlePlayHere({ attemptId, deviceId, contentId: item.contentId ?? null });
    outcomes?.removeDispatch?.(attemptId);
    executeItemAction({ kind: 'playNow', item, destination: localController })
      .then((result) => { if (result?.ok === false) mediaLog.screenHandleFailed({ deviceId: 'local', action: 'playHere', error: result.reason ?? result.code }); })
      .catch((error) => mediaLog.screenHandleFailed({ deviceId: 'local', action: 'playHere', error: error?.message ?? String(error) }));
  };
  const retry = () => { mediaLog.screenHandleRetry({ attemptId, deviceId, status: view.status }); outcomes?.retry?.(attemptId); };
  const dismiss = () => outcomes?.removeDispatch?.(attemptId);

  if (view.status === 'starting') {
    const last = record.steps?.[record.steps.length - 1];
    const step = last ? friendlyStepLabel(last.step, deviceKind(device)) : null;
    return (
      <Bar deviceId={deviceId} status="starting" title={title} name={name} onOpen={open}
        stateLine={`Starting on ${name}…${step ? ` ${step}` : ''}`}
        icon={<span className="cast-tray-spinner screen-handle-spinner" data-testid="screen-handle-spinner" aria-hidden />}>
        <UndoAction d={record} removeDispatch={outcomes?.removeDispatch} recordLocal={outcomes?.recordLocal} />
        <UnstyledButton className="np-icon-btn" data-testid="screen-handle-stop" aria-label={`Stop ${name}`}
          onClick={() => { mediaLog.screenHandleCommand({ deviceId, action: 'stop-start' }); outcomes?.stopAttempt?.(attemptId); }}>
          <IconPlayerStopFilled size={18} />
        </UnstyledButton>
      </Bar>
    );
  }

  if (view.status === 'failed' || view.status === 'preempted') {
    const headline = view.status === 'preempted'
      ? `${name} is now playing ${presentTitle(view.other) ?? view.other?.title ?? 'something else'}`
      : view.phase === 'unconfirmed' ? `${name} may not have started` : `${name} didn't start`;
    const why = view.status === 'failed' ? failureReason(record, view.phase, deviceKind(device)) : null;
    return (
      <Bar deviceId={deviceId} status={view.status} title={title} name={name} onOpen={open}
        stateLine={why ? `${headline} · ${why}` : headline}
        icon={<span className="mini-player-problem" aria-hidden><IconAlertCircle size={18} /></span>}>
        <UnstyledButton className="screen-handle-action" data-testid="screen-handle-retry" onClick={retry}>
          <IconRefresh size={16} aria-hidden /> Retry
        </UnstyledButton>
        <UnstyledButton className="screen-handle-action" data-testid="screen-handle-play-here" onClick={playHere}>
          <IconDeviceLaptop size={16} aria-hidden /> Play here
        </UnstyledButton>
        <UnstyledButton className="np-icon-btn" data-testid="screen-handle-dismiss" aria-label="Dismiss" onClick={dismiss}>
          <IconX size={16} />
        </UnstyledButton>
      </Bar>
    );
  }

  const stateLine = snapshot?.state ? (playbackStateLabel(snapshot.state) || 'Playing') : 'Playing';
  return (
    <Bar deviceId={deviceId} status={view.status} title={title} name={name} onOpen={open} stateLine={stateLine}>
      {record.startOver === true && typeof outcomes?.startOver === 'function' && (
        <UnstyledButton className="screen-handle-action" data-testid="screen-handle-start-over" onClick={() => outcomes.startOver(attemptId)}>
          <IconRotate size={16} aria-hidden /> Start over
        </UnstyledButton>
      )}
      <SessionButtons deviceId={deviceId} name={name} snapshot={snapshot} controller={controller} onStopped={dismiss} />
    </Bar>
  );
}

/** STEER.1a/AC4: the screen most recently steered, or aimed at, while it plays. */
function HandleBar({ deviceId, why }) {
  const { device, entry } = useDevice(deviceId);
  const peek = useContext(PeekContext);
  const { push, view, params } = useNav();
  const snapshot = entry?.snapshot ?? null;
  const item = snapshot?.currentItem ?? null;
  const name = deviceName(device, deviceId);
  const shownRef = useRef(false);
  useEffect(() => {
    if (shownRef.current) return undefined;
    shownRef.current = true;
    mediaLog.screenHandleShown({ deviceId, why });
    return () => { mediaLog.screenHandleHidden({ deviceId }); };
  }, [deviceId, why]);

  // Its full controls are open: do not duplicate them.
  if (view === 'peek' && params?.deviceId === deviceId) return null;
  if (!item) return null;
  const title = presentTitle(item) ?? item.contentId;
  return (
    <Bar deviceId={deviceId} status={snapshot.state === 'paused' ? 'paused' : 'playing'} title={title} name={name}
      stateLine={playbackStateLabel(snapshot.state)} onOpen={() => push('peek', { deviceId })}>
      <SessionButtons deviceId={deviceId} name={name} snapshot={snapshot} controller={peek?.getController?.(deviceId) ?? null} />
    </Bar>
  );
}

export function ScreenHandle() {
  const fleet = useFleetContext();
  const peek = useContext(PeekContext);
  const outcomes = useContext(DispatchContext)?.outcomes ?? null;
  const { targetIds } = useCastTarget();
  const lastSteeredId = peek?.lastSteeredId ?? null;
  const store = fleet?.store ?? null;
  const devices = fleet?.devices ?? [];
  // Re-render as screens report: the bar appears and disappears with their state.
  const watched = [lastSteeredId, ...(targetIds ?? [])].filter(Boolean);
  const [, force] = React.useReducer((n) => n + 1, 0);
  useEffect(() => {
    if (!store?.subscribeDevice) return undefined;
    const unsubs = [...new Set(watched)].map((id) => store.subscribeDevice(id, force));
    return () => unsubs.forEach((unsub) => unsub?.());
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the ids
  }, [store, watched.join('|')]);
  const play = pickHandlePlay(outcomes ? outcomes.values() : []);
  if (play) return <PlayBar key={play.attemptId ?? play.dispatchId} record={play} />;
  const picked = pickHandleScreen({
    lastSteeredId,
    aimIds: targetIds ?? [],
    entryFor: (id) => store?.getEntry?.(id) ?? null,
    isLocal: (id) => devices.find((d) => d.id === id)?.isLocal === true,
  });
  if (!picked) return null;
  return <HandleBar key={picked.deviceId} deviceId={picked.deviceId} why={picked.why} />;
}

export default ScreenHandle;
