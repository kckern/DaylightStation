// frontend/src/modules/Media/shell/LineUpOffer.jsx
// "Line up with <other screen>" (PLACE.4a/AC5, RQ-PLACE-10). Several screens
// started together are steered separately and drift apart; when the screen
// being steered and another one (or this device) are playing the same item,
// its controls offer to seek it to the other's reported spot. The spot is
// the other's last report, carried forward by the time since it was heard
// while it plays.
import React, { useCallback, useContext, useSyncExternalStore } from 'react';
import { Button, Group } from '@mantine/core';
import { IconArrowsHorizontal } from '@tabler/icons-react';
import { useSessionController } from '../controller/useSessionController.js';
import { useFleetContext } from '../fleet/useFleetContext.js';
import { deviceName } from '../fleet/deviceDisplay.js';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { DispatchContext } from '../cast/DispatchProvider.jsx';
import mediaLog from '../logging/mediaLog.js';
import { reportedSpot } from '../cast/reportedSpot.js';

export { reportedSpot };
import './SessionControls.scss';

const ACTIVE = new Set(['playing', 'paused', 'buffering']);
const EMPTY = new Map();
const NO_SUBSCRIBE = () => () => {};

/**
 * Other screens (and this device) playing the same item as `contentId`.
 * @returns {Array<{ id, name, spot }>}
 */
export function lineUpPeers({ selfId, contentId, entries = EMPTY, devices = [], local = null, now = Date.now() }) {
  if (!contentId) return [];
  const peers = [];
  for (const [id, entry] of entries) {
    if (id === selfId || entry?.offline || entry?.isStale) continue;
    const snap = entry?.snapshot;
    if (!ACTIVE.has(snap?.state) || snap?.currentItem?.contentId !== contentId) continue;
    if (local?.browserId && id === local.browserId) continue; // this device is offered from its own session below
    const spot = reportedSpot(snap, entry.receivedAt, now);
    if (spot == null) continue;
    const device = devices.find((candidate) => candidate.id === id) ?? null;
    peers.push({ id, name: deviceName(device, id), spot });
  }
  if (local && selfId !== 'local' && ACTIVE.has(local.snapshot?.state)
    && local.snapshot?.currentItem?.contentId === contentId && Number.isFinite(local.seconds)) {
    peers.push({ id: 'local', name: 'This device', spot: local.seconds });
  }
  return peers;
}

export function LineUpOffer({ target, targetName = null }) {
  const { controller, snapshot, transport } = useSessionController(target);
  const { devices = [], store, identity } = useFleetContext();
  const localController = useContext(LocalSessionContext)?.controller ?? null;
  const outcomes = useContext(DispatchContext);
  const subscribe = useCallback((notify) => store?.subscribeAll?.(notify) ?? (() => {}), [store]);
  const getAll = useCallback(() => store?.getAll?.() ?? EMPTY, [store]);
  const entries = useSyncExternalStore(subscribe, getAll, getAll);
  const localSubscribe = useCallback((cb) => localController?.subscribe?.(cb) ?? NO_SUBSCRIBE(), [localController]);
  const localGet = useCallback(() => localController?.getSnapshot?.() ?? null, [localController]);
  const localSnapshot = useSyncExternalStore(localSubscribe, localGet, localGet);

  const isLocal = target === 'local';
  const selfId = isLocal ? 'local' : target?.deviceId;
  const contentId = snapshot?.currentItem?.contentId ?? null;
  const canSeek = controller?.capabilities?.seekable !== false && snapshot?.currentItem?.isLive !== true;
  const peers = lineUpPeers({
    selfId: isLocal ? identity?.deviceId : selfId,
    contentId,
    entries,
    devices,
    local: isLocal ? null : {
      browserId: identity?.deviceId ?? null,
      snapshot: localSnapshot,
      seconds: localController?.position?.get?.()?.seconds ?? localSnapshot?.position,
    },
  });
  if (!contentId || peers.length === 0 || !canSeek) return null;

  const lineUp = async (peer) => {
    // Re-read at the press: the spot moves on while the button is shown.
    const fresh = peer.id === 'local'
      ? (localController?.position?.get?.()?.seconds ?? peer.spot)
      : (reportedSpot(store?.getEntry?.(peer.id)?.snapshot, store?.getEntry?.(peer.id)?.receivedAt) ?? peer.spot);
    mediaLog.lineUpRequested({ target: selfId, withId: peer.id, contentId, seconds: Math.round(fresh) });
    let result;
    try { result = await transport.seekAbs?.(fresh); } catch (error) { result = { ok: false, error: error?.message }; }
    const title = snapshot?.currentItem?.title ?? 'it';
    if (result?.ok === false) {
      mediaLog.lineUpFailed({ target: selfId, withId: peer.id, error: result.error ?? null });
      outcomes?.recordLocal?.({
        kind: 'lineUp', phase: 'failed', item: { contentId, title },
        reason: result.error ?? 'The screen did not confirm the change',
        targetId: isLocal ? 'local' : selfId, targetName: isLocal ? null : targetName,
      });
      return;
    }
    outcomes?.recordLocal?.({
      kind: 'lineUp', phase: 'confirmed', item: { contentId, title: `${title} with ${peer.name}` },
      targetId: isLocal ? 'local' : selfId, targetName: isLocal ? null : targetName,
    });
  };

  return (
    <Group gap="xs" className="session-controls-row" data-testid="line-up-offer">
      {peers.map((peer) => (
        <Button
          key={peer.id}
          data-testid={`line-up-${peer.id}`}
          className="session-controls-btn"
          size="sm"
          variant="default"
          leftSection={<IconArrowsHorizontal size={16} />}
          onClick={() => lineUp(peer)}
        >
          Line up with {peer.name}
        </Button>
      ))}
    </Group>
  );
}

export default LineUpOffer;
