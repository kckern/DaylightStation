// frontend/src/modules/Media/cast/useStartingOn.js
// PLAY.1a/AC5 (RQ-PLAY-07): while an item's start is still in flight on a
// screen, the item itself reads "Starting on <screen>…" — wherever it
// appears — so a second tap is plainly unnecessary (and the dispatch layer
// would not send it twice anyway).
import { useCallback, useContext } from 'react';
import { DispatchContext } from './DispatchProvider.jsx';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { deviceName } from '../fleet/deviceDisplay.js';
import { outcomePhase } from './dispatchReducer.js';

const STARTING_KINDS = new Set(['play', 'shuffle', 'playNow']);
const STARTING_PHASES = new Set(['running', 'sent']);

/** Pure: the screen ids an item is currently starting on. */
export function startingTargets(records, contentId) {
  if (!contentId || !records) return [];
  const targets = [];
  for (const record of records.values()) {
    if (record.distance === 'here' || record.distance === 'direct') continue;
    if (record.operation === 'add' || (record.kind && !STARTING_KINDS.has(record.kind))) continue;
    if ((record.item?.contentId ?? record.contentId) !== contentId) continue;
    if (!STARTING_PHASES.has(record.phase ?? outcomePhase(record))) continue;
    const id = record.targetId ?? record.deviceId;
    if (id && !targets.includes(id)) targets.push(id);
  }
  return targets;
}

export function useStartingOn() {
  const outcomes = useContext(DispatchContext)?.outcomes ?? null;
  const devices = useContext(FleetContext)?.devices ?? [];
  const startingOnFor = useCallback((contentId) => {
    const targets = startingTargets(outcomes, contentId);
    if (!targets.length) return null;
    const names = targets.map((id) => deviceName(devices.find((d) => d.id === id) ?? null, id));
    return `Starting on ${names.length > 1 ? `${names.length} screens` : names[0]}…`;
  }, [outcomes, devices]);
  return { startingOnFor };
}

export default useStartingOn;
