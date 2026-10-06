// frontend/src/modules/Media/house/houseQuiet.js
// Pause all / Stop all / Resume all (RQ-STEER-13, STEER.11a): one step to
// quiet the house. Fans out over every screen's own session transport (the
// same remote controllers a row's Pause uses) plus this device's local
// session, remembers which screens a Pause all actually paused so Resume all
// brings back exactly those, and reports through the one outcome system —
// every screen it could not reach is named as not paused/stopped.
import { useCallback, useContext, useMemo, useState, useSyncExternalStore } from 'react';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { PeekContext } from '../peek/PeekContext.js';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { DispatchContext } from '../cast/DispatchProvider.jsx';
import { quietSummary } from './houseCopy.js';
import houseLog from './houseLog.js';

export const LOCAL_TARGET = 'local';
const PLAYING = new Set(['playing', 'buffering']);
const ACTIVE = new Set(['playing', 'paused', 'buffering', 'stalled']);
const ANSWER_TIMEOUT_MS = 8_000;
const NO_SUB = () => () => {};
const NO_SNAP = () => null;

function stateOf(device, entry) {
  return device?.state ?? entry?.snapshot?.state ?? 'unknown';
}

function unreachable(device, entry) {
  return entry?.offline === true || device?.state === 'offline' || device?.connected === false;
}

/**
 * Which screens a house-wide action touches. Pure.
 * @param {'pause'|'stop'|'resume'} verb
 * @returns {{targets: {id,name}[], missed: {id,name,reason}[]}}
 */
export function planQuiet(verb, { devices = [], getEntry = () => null, localState = null, resumable = null } = {}) {
  const wanted = (state, id) => {
    if (verb === 'resume') return Array.isArray(resumable) && resumable.includes(id);
    return (verb === 'pause' ? PLAYING : ACTIVE).has(state);
  };
  const targets = [];
  const missed = [];
  for (const device of devices) {
    if (device.isLocal) continue; // this device is steered locally below
    const entry = getEntry(device.id);
    // A resume targets a remembered screen whatever it reports now.
    if (!wanted(stateOf(device, entry), device.id)) continue;
    if (unreachable(device, entry)) missed.push({ id: device.id, name: device.name ?? device.id, reason: 'not reachable' });
    else targets.push({ id: device.id, name: device.name ?? device.id });
  }
  if (wanted(localState, LOCAL_TARGET)) targets.push({ id: LOCAL_TARGET, name: 'This device' });
  return { targets, missed };
}

function withTimeout(promise) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ANSWER_TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(timer));
}

const ACTION = { pause: 'pause', stop: 'stop', resume: 'play' };

/** The house-wide actions, for the house view and the handle. */
export function useHouseQuiet() {
  const fleet = useContext(FleetContext);
  const peek = useContext(PeekContext);
  const local = useContext(LocalSessionContext)?.controller ?? null;
  const outcomes = useContext(DispatchContext);
  const [busy, setBusy] = useState(null);
  const localState = useSyncExternalStore(
    local?.subscribe ? (cb) => local.subscribe(cb) : NO_SUB,
    local?.getSnapshot ? () => local.getSnapshot()?.state ?? null : NO_SNAP,
    local?.getSnapshot ? () => local.getSnapshot()?.state ?? null : NO_SNAP,
  );
  const devices = fleet?.devices ?? [];
  const store = fleet?.store ?? null;
  const resumable = fleet?.quiet?.resumable ?? null;
  const setResumable = fleet?.quiet?.setResumable;

  const run = useCallback(async (verb) => {
    const getEntry = (id) => store?.getEntry?.(id) ?? null;
    const { targets, missed } = planQuiet(verb, { devices, getEntry, localState, resumable });
    setBusy(verb);
    const done = [];
    const doneIds = [];
    const failed = [];
    await Promise.all(targets.map(async (target) => {
      const transport = target.id === LOCAL_TARGET ? local?.transport : peek?.getController?.(target.id)?.transport;
      const send = transport?.[ACTION[verb]];
      if (typeof send !== 'function') {
        failed.push({ ...target, reason: "can't be controlled" });
        return;
      }
      try {
        const result = await withTimeout(send());
        if (result && result.ok === false) throw new Error(result.error ?? result.code ?? 'refused');
        // A house-wide stop means quiet: music left behind a slideshow goes too
        // (a person's own Stop is asked "Keep the music?"; this one is not).
        if (verb === 'stop' && target.id !== LOCAL_TARGET && getEntry(target.id)?.snapshot?.controls?.musicBehind) {
          try { await withTimeout(peek?.getController?.(target.id)?.sessionControls?.musicBehind?.('stop')); } catch { /* best effort */ }
        }
        done.push(target.name);
        doneIds.push(target.id);
      } catch {
        // A refusal, an ack timeout or no answer at all: not quieted.
        failed.push({ ...target, reason: "didn't answer" });
      }
    }));
    const allMissed = [...missed, ...failed.sort((a, b) => a.name.localeCompare(b.name))];
    if (verb === 'pause') setResumable?.(doneIds.length ? doneIds : resumable);
    else if (verb === 'stop') setResumable?.(null);
    else setResumable?.(failed.length ? failed.map((f) => f.id) : null);
    const copy = quietSummary(verb, { done, missed: allMissed.map(({ name, reason }) => ({ name, reason })) });
    houseLog.quietAll({ verb, targets: targets.map((t) => t.id), done: doneIds, missed: allMissed.map((m) => ({ id: m.id, reason: m.reason })) });
    if (allMissed.length) houseLog.quietAllUnreached({ verb, missed: allMissed.map((m) => m.id) });
    outcomes?.recordLocal?.({
      kind: `${verb}All`,
      phase: allMissed.length ? 'failed' : 'confirmed',
      item: { contentId: null, title: null },
      command: { copy },
    });
    setBusy(null);
    return { done: doneIds, missed: allMissed };
  }, [devices, store, localState, resumable, setResumable, local, peek, outcomes]);

  const pauseAll = useCallback(() => run('pause'), [run]);
  const stopAll = useCallback(() => run('stop'), [run]);
  const resumeAll = useCallback(() => run('resume'), [run]);

  const counts = useMemo(() => {
    const getEntry = (id) => store?.getEntry?.(id) ?? null;
    const playing = planQuiet('pause', { devices, getEntry, localState });
    const active = planQuiet('stop', { devices, getEntry, localState });
    return {
      playing: playing.targets.length + playing.missed.length,
      active: active.targets.length + active.missed.length,
    };
  }, [devices, store, localState]);

  return {
    pauseAll, stopAll, resumeAll, busy,
    canResume: Array.isArray(resumable) && resumable.length > 0,
    resumable: resumable ?? [],
    playingCount: counts.playing,
    activeCount: counts.active,
  };
}

export default useHouseQuiet;
