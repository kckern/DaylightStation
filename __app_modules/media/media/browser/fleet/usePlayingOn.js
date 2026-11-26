// fleet/usePlayingOn.js
// Addendum item 5 (2026-11-26): already playing is shown. An item that is on
// a screen right now reads "On <screen>" wherever it appears — search rows,
// tiles, the info view — and offers Pause / Open instead of a fresh ▶. PLAY
// there is the explicit "Start over on <screen>", nothing else.
//
// Read from the fleet's live device state (the same entries the picker and
// the handle read); the commands go to that screen's SessionController (the
// one PeekPanel uses). Safe outside the providers: no fleet, no answer.
import { useCallback, useContext, useEffect, useReducer } from 'react';
import { FleetContext } from "./FleetProvider.jsx";
import { PeekContext } from "../peek/PeekContext.js";
import { NavContext } from "../shell/navContext.js";
import { deviceName } from "./deviceDisplay.js";
import mediaLog from "../logging/mediaLog.js";

const ON_STATES = new Set(['playing', 'paused', 'buffering', 'stalled']);

/**
 * Pure: the screen (not this device) currently playing or paused on `contentId`.
 * @returns {{ deviceId: string, name: string, state: string, paused: boolean }|null}
 */
export function playingOnScreen({ contentId, devices = [], entryFor, localId = null }) {
  if (!contentId || typeof entryFor !== 'function') return null;
  for (const device of devices) {
    if (!device?.id || device.isLocal === true || device.id === localId) continue;
    const entry = entryFor(device.id);
    const snap = entry && !entry.offline && !entry.isStale ? entry.snapshot : null;
    if (!snap || !ON_STATES.has(snap.state) || snap.currentItem?.contentId !== contentId) continue;
    return { deviceId: device.id, name: deviceName(device, device.id), state: snap.state, paused: snap.state === 'paused' };
  }
  return null;
}

export function usePlayingOn() {
  const fleet = useContext(FleetContext);
  const peek = useContext(PeekContext);
  const nav = useContext(NavContext);
  const store = fleet?.store ?? null;
  const devices = fleet?.devices ?? [];
  const localId = fleet?.identity?.deviceId ?? null;
  const [, force] = useReducer((n) => n + 1, 0);
  useEffect(() => (store?.subscribeAll ? store.subscribeAll(force) : undefined), [store]);

  const playingOnFor = useCallback((contentId) => playingOnScreen({
    contentId, devices, localId, entryFor: (id) => store?.getEntry?.(id) ?? null,
  }), [devices, localId, store]);

  const command = useCallback((on, action, contentId = null) => {
    const transport = peek?.getController?.(on.deviceId)?.transport;
    mediaLog.playingOnCommand({ deviceId: on.deviceId, action, contentId });
    const invoke = action === 'startOver' ? transport?.restartCurrent : transport?.[action];
    if (typeof invoke !== 'function') {
      mediaLog.playingOnFailed({ deviceId: on.deviceId, action, error: 'unsupported' });
      return Promise.resolve({ ok: false, code: 'UNSUPPORTED' });
    }
    const failed = (error) => {
      mediaLog.playingOnFailed({ deviceId: on.deviceId, action, error: error?.message ?? String(error) });
      return { ok: false, error: error?.message };
    };
    try { return Promise.resolve(invoke()).catch(failed); } catch (error) { return Promise.resolve(failed(error)); }
  }, [peek]);

  /** Pause, or resume when that screen is paused. */
  const toggle = useCallback((on, contentId) => command(on, on.paused ? 'play' : 'pause', contentId), [command]);
  /** The explicit Start over on that screen: the item from 0, there. */
  const startOver = useCallback((on, contentId) => command(on, 'startOver', contentId), [command]);
  /** That screen's full controls. */
  const open = useCallback((on) => {
    mediaLog.playingOnCommand({ deviceId: on.deviceId, action: 'open' });
    nav?.push?.('peek', { deviceId: on.deviceId });
  }, [nav]);

  return { playingOnFor, toggle, startOver, open };
}

export default usePlayingOn;
