// The destination, where you type: a chip at the search box's right end that
// says where ▶ plays ("▶ Office Screen", "▶ This device"). Tab / Shift+Tab in
// the box (wired by the search surfaces through useDestinationCycle) and a
// click on the chip walk one fixed cycle — the usual film screen, the other
// screens that can take a film by name, then This device
// (habits/destinationCycle.js). A step only writes the aim (sticky,
// CastTargetProvider.setTargets): nothing is woken, powered or contacted.
//
// The chip always names where a film's ▶ goes (with nothing aimed a song's ▶
// may differ: music follows its own habit, playDestination.js): an aimed
// screen; This device when chosen on purpose (a sticky choice of its own,
// CastTargetProvider `here`); with nothing chosen, the learned film screen or
// "▶ Choose a screen" when ▶ would ask. Names come from the fleet as it is
// now: a screen that left it (unplugged, renamed) is never shown by its id or
// an old name — once the fleet has loaded and answered without it the chip
// reads the unaimed state and the dead aim is let go. Until then (loading,
// empty, errored) the aim is still where row ▶ sends, so the chip names it.
// The phone header's "Playing on" control reads the same label
// (useDestinationLabel), so the two never disagree.
import React, { useCallback, useContext, useEffect, useMemo } from 'react';
import { UnstyledButton } from '@mantine/core';
import { UiIcon } from '@/lib/ui/UiIcon.jsx';
import { CastTargetContext } from "../cast/CastTargetProvider.jsx";
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { ClientIdentityContext } from "../identity/ClientIdentityProvider.jsx";
import { deviceName } from "../fleet/deviceDisplay.js";
import { aimKey, destinationCycle, nextDestination } from "../habits/destinationCycle.js";
import { usePlayDestination } from "../habits/usePlayDestination.js";
import mediaLog from "../logging/mediaLog.js";
import "./Search.scss";

const NO_IDS = Object.freeze([]);
const HERE_LABEL = 'This device';
const ASK_LABEL = 'Choose a screen';
// The phone's search row is narrow: the ask reads short there (the
// accessible name keeps the whole sentence).
const ASK_SHORT_LABEL = 'Choose';
const UNKNOWN_SCREEN = 'Screen';
const FILM = Object.freeze({ type: 'movie' });

/**
 * What ▶ does for a film with nothing chosen: the learned screen, here, or
 * ask. `shownIds` is the cycle entry the label names (null when ▶ asks), so a
 * step moves on from what the chip shows and always changes it.
 */
function unaimedDestination(usual) {
  if (usual.source === 'learned') {
    return { targetIds: NO_IDS, shownIds: usual.targetIds, label: usual.devices.map((d) => deviceName(d)).join(' + '), unaimed: true, stale: false };
  }
  if (usual.source === 'here') return { targetIds: NO_IDS, shownIds: NO_IDS, label: HERE_LABEL, unaimed: true, stale: false };
  return { targetIds: NO_IDS, shownIds: null, label: ASK_LABEL, unaimed: true, stale: false };
}

/**
 * Has the fleet answered successfully (so a screen missing from it is really
 * gone)? Loading, errored or empty is not an answer.
 */
export function fleetHasSettled(fleet) {
  return !!fleet && !fleet.loading && !fleet.error && (fleet.devices?.length ?? 0) > 0;
}

/** An aim named before the fleet has answered: known names, else neutral words — never an id. */
function pendingAimLabel(targetIds, devices) {
  const found = targetIds.map((id) => devices.find((d) => d.id === id));
  if (found.every(Boolean)) return found.map((d) => deviceName(d)).join(' + ');
  return targetIds.length === 1 ? UNKNOWN_SCREEN : `${targetIds.length} screens`;
}

/**
 * What the chip names: always where a film's ▶ goes now. An aim → its
 * screens (live fleet names); This device chosen → This device; nothing
 * chosen → what ▶ would do unaimed. An aim at a screen gone from a settled
 * fleet reads as nothing chosen (stale), never an id; before the fleet has
 * settled the aim is named as it stands (row ▶ still sends there).
 */
function describeAim(order, targetIds, here, devices, usual, settled) {
  if (targetIds.length === 0) {
    return here ? { targetIds: NO_IDS, label: HERE_LABEL, unaimed: false, stale: false } : unaimedDestination(usual);
  }
  const key = aimKey(targetIds);
  const step = order.find((c) => aimKey(c.targetIds) === key);
  if (step) return { ...step, unaimed: false, stale: false };
  // Off the cycle but still in the fleet (several screens, a speaker aimed
  // from the phone's destination control): name them as they are now.
  const found = targetIds.map((id) => devices.find((d) => d.id === id));
  if (found.every(Boolean)) return { targetIds, label: found.map((d) => deviceName(d)).join(' + '), unaimed: false, stale: false };
  if (!settled) return { targetIds, label: pendingAimLabel(targetIds, devices), unaimed: false, stale: false };
  return { ...unaimedDestination(usual), stale: true };
}

/**
 * The search box's destination cycle.
 * @returns {{ current: {targetIds: string[], label: string, unaimed: boolean, stale: boolean},
 *   cycle: (dir?: 1|-1, via?: 'tab'|'click') => boolean }}
 *   `cycle` returns false (nothing handled) outside an aim provider.
 */
export function useDestinationCycle() {
  const aim = useContext(CastTargetContext);
  const fleet = useContext(FleetContext);
  // What ▶ does for a film with nothing chosen (learned / here / ask) —
  // also the usual film screen that leads the cycle.
  const { destinationFor } = usePlayDestination({ aimIds: NO_IDS, here: false });
  const devices = fleet?.devices ?? NO_IDS;
  const localId = fleet?.identity?.deviceId ?? null;
  const usual = destinationFor(FILM);
  const usualKey = usual.source === 'learned' ? usual.targetIds.join(',') : '';
  const order = useMemo(
    () => destinationCycle({ devices, usualIds: usualKey ? usualKey.split(',') : NO_IDS, localId }),
    [devices, usualKey, localId],
  );
  const targetIds = aim?.targetIds ?? NO_IDS;
  const here = aim?.here === true;
  const settled = fleetHasSettled(fleet);
  const current = useMemo(
    () => describeAim(order, targetIds, here, devices, usual, settled),
    // usual: re-described when what is learned changes (its source/key/names).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, targetIds, here, devices, usual.source, usualKey, settled],
  );
  const setTargets = aim?.setTargets;

  const cycle = useCallback((dir = 1, via = 'tab') => {
    if (!setTargets) return false;
    const step = dir === -1 ? -1 : 1;
    // Every step changes the label: from the entry the chip shows (the
    // learned screen, This device), or — when ▶ would ask — to the first
    // entry (Shift+Tab: the last).
    const from = current.unaimed ? current.shownIds : current.targetIds;
    const next = from == null
      ? order[step === 1 ? 0 : order.length - 1]
      : nextDestination(order, from, step);
    setTargets(next.targetIds, { here: next.targetIds.length === 0 });
    mediaLog.searchDestinationCycled({
      from: current.unaimed && !current.stale ? 'unaimed' : aimKey(targetIds),
      to: aimKey(next.targetIds),
      via,
    });
    return true;
  }, [setTargets, order, current, targetIds]);

  return { current, cycle };
}

/**
 * Where a film's ▶ goes, as the chip names it — for any other surface that
 * shows the destination (the phone header), so they always agree.
 * @returns {{ label: string, asks: boolean, here: boolean }}
 */
export function useDestinationLabel() {
  const { current } = useDestinationCycle();
  return {
    label: current.label,
    asks: current.unaimed && current.label === ASK_LABEL,
    here: current.label === HERE_LABEL,
  };
}

/** @param {{ compact?: boolean }} props - `compact`: the phone's narrow search row. */
export function DestinationChip({ compact = false } = {}) {
  const aim = useContext(CastTargetContext);
  const fleet = useContext(FleetContext);
  const identity = useContext(ClientIdentityContext);
  const { current, cycle } = useDestinationCycle();

  // Let go of an aim at a screen that is gone — only once the fleet has
  // actually answered (a restored aim must survive the first, empty render).
  const fleetSettled = fleetHasSettled(fleet);
  const targetIds = aim?.targetIds ?? NO_IDS;
  const setTargets = aim?.setTargets;
  useEffect(() => {
    if (!current.stale || !fleetSettled || !setTargets) return;
    const present = targetIds.filter((id) => fleet.devices.some((d) => d.id === id));
    mediaLog.searchDestinationStale({ targetIds: targetIds.filter((id) => !present.includes(id)) });
    setTargets(present);
  }, [current.stale, fleetSettled, setTargets, targetIds, fleet]);

  if (!aim) return null;
  const asks = current.unaimed && current.label === ASK_LABEL;
  const here = current.label === HERE_LABEL;
  const shown = asks && compact ? ASK_SHORT_LABEL : current.label;
  return (
    <>
      <UnstyledButton
        data-testid="search-destination-chip"
        className="media-destination-chip"
        data-here={here || undefined}
        data-asks={asks || undefined}
        aria-label={`Plays on ${current.label}. Change where things play`}
        title="Where a film's ▶ plays — Tab to change"
        // The search box keeps its focus, words and open list.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          // Reaching for the destination answers the naming prompt anchored here.
          if (identity?.firstUse) identity.completeFirstUse?.('skipped');
          cycle(1, 'click');
        }}
      >
        {!here && !asks && <UiIcon name="television" size={16} className="media-destination-chip-icon" />}
        <span className="media-destination-chip-text">▶ {shown}</span>
      </UnstyledButton>
      <span className="media-sr-only" role="status" aria-live="polite" data-testid="search-destination-announcement">
        {`Plays on ${current.label}`}
      </span>
    </>
  );
}

export default DestinationChip;
