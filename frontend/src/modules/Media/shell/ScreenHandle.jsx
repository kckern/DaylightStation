// frontend/src/modules/Media/shell/ScreenHandle.jsx
// STEER.1a/AC4 (RQ-STEER-01): the handle also covers the screen this device
// most recently sent to or steered, so pausing the TV when the phone rings is
// one tap, from any part of the app. It names the screen, shows what it is
// playing, and carries play/pause; tapping the title opens that screen's full
// controls (and the bar steps aside while those are open, so it never
// duplicates them). It is chrome, not a notice: it appears only while that
// screen is actually playing or paused.
import React, { useContext, useEffect, useRef } from 'react';
import { IconPlayerPauseFilled, IconPlayerPlayFilled } from '@tabler/icons-react';
import { useFleetContext } from '../fleet/useFleetContext.js';
import { useDevice } from '../fleet/useDevice.js';
import { PeekContext } from '../peek/PeekContext.js';
import { useCastTarget } from '../cast/useCastTarget.js';
import { deviceName } from '../fleet/deviceDisplay.js';
import { useNav } from './NavProvider.jsx';
import { presentTitle } from '../browse/tilePresentation.js';
import { pickHandleScreen } from './screenHandleModel.js';
import { playbackStateLabel } from './stateCopy.js';
import mediaLog from '../logging/mediaLog.js';
import './NowPlaying.scss';

function HandleBar({ deviceId, why }) {
  const { device, entry } = useDevice(deviceId);
  const peek = useContext(PeekContext);
  const { push, view, params } = useNav();
  const snapshot = entry?.snapshot ?? null;
  const item = snapshot?.currentItem ?? null;
  const playing = snapshot?.state === 'playing' || snapshot?.state === 'buffering';
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

  const toggle = () => {
    const action = playing ? 'pause' : 'play';
    mediaLog.screenHandleCommand({ deviceId, action });
    const result = peek?.getController?.(deviceId)?.transport?.[action]?.();
    Promise.resolve(result).catch((error) => mediaLog.screenHandleFailed({ deviceId, action, error: error?.message ?? String(error) }));
  };
  const title = presentTitle(item) ?? item.contentId;

  return (
    <div className="screen-handle" data-testid="screen-handle" data-device-id={deviceId}>
      <button
        type="button"
        className="screen-handle-open"
        data-testid="screen-handle-open"
        aria-label={`Open controls for ${name}, ${title}. ${playbackStateLabel(snapshot.state)}`}
        onClick={() => push('peek', { deviceId })}
      >
        <span className="screen-handle-name" data-testid="screen-handle-name">{name} · {playbackStateLabel(snapshot.state)}</span>
        <span className="screen-handle-title">{title}</span>
      </button>
      <button
        type="button"
        className={`np-icon-btn np-icon-btn--primary${playing ? '' : ' mini-resume'}`}
        data-testid="screen-handle-toggle"
        aria-label={playing ? `Pause ${name}` : `Resume ${name}`}
        onClick={toggle}
      >
        {playing ? <IconPlayerPauseFilled size={20} /> : <IconPlayerPlayFilled size={18} />}
      </button>
    </div>
  );
}

export function ScreenHandle() {
  const fleet = useFleetContext();
  const peek = useContext(PeekContext);
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
