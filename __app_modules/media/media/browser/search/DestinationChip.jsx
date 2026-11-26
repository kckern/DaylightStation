// The destination, where you type: a chip at the search box's right end that
// says where ▶ plays ("▶ Office Screen", "▶ This device"). Tab / Shift+Tab in
// the box (wired by the search surfaces through useDestinationCycle) and a
// click on the chip walk one fixed cycle — the usual film screen, the other
// screens that can take a film by name, then This device
// (habits/destinationCycle.js). A step only writes the aim (sticky,
// CastTargetProvider.setTargets): nothing is woken, powered or contacted.
//
// The label always comes from the fleet as it is now. A screen that left it
// (unplugged, renamed) is never shown by its id or an old name: the chip reads
// "▶ This device" and, once the fleet has loaded, the dead aim is let go so
// what ▶ does and what the chip says cannot disagree.
import React, { useCallback, useContext, useEffect, useMemo } from 'react';
import { UnstyledButton } from '@mantine/core';
import { UiIcon } from '@/lib/ui/UiIcon.jsx';
import { CastTargetContext } from "../cast/CastTargetProvider.jsx";
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { ClientIdentityContext } from "../identity/ClientIdentityProvider.jsx";
import { deviceName } from "../fleet/deviceDisplay.js";
import { destinationCycle, nextDestination } from "../habits/destinationCycle.js";
import { usePlayDestination } from "../habits/usePlayDestination.js";
import mediaLog from "../logging/mediaLog.js";
import "./Search.scss";

const NO_IDS = Object.freeze([]);
const HERE_LABEL = 'This device';
const FILM = Object.freeze({ type: 'movie' });

function aimKey(ids) {
  return ids.length === 0 ? 'local' : [...ids].sort().join(',');
}

/** What the chip names for `targetIds`, from the cycle and the live fleet. */
function describeAim(order, targetIds, devices) {
  if (targetIds.length === 0) return { targetIds: NO_IDS, label: HERE_LABEL, stale: false };
  const key = aimKey(targetIds);
  const step = order.find((c) => aimKey(c.targetIds) === key);
  if (step) return { ...step, stale: false };
  // Off the cycle but still in the fleet (several screens, a speaker aimed
  // from the phone's destination control): name them as they are now.
  const found = targetIds.map((id) => devices.find((d) => d.id === id));
  if (found.every(Boolean)) return { targetIds, label: found.map((d) => deviceName(d)).join(' + '), stale: false };
  return { targetIds: NO_IDS, label: HERE_LABEL, stale: true };
}

/**
 * The search box's destination cycle.
 * @returns {{ current: {targetIds: string[], label: string, stale: boolean},
 *   cycle: (dir?: 1|-1, via?: 'tab'|'click') => boolean }}
 *   `cycle` returns false (nothing handled) outside an aim provider.
 */
export function useDestinationCycle() {
  const aim = useContext(CastTargetContext);
  const fleet = useContext(FleetContext);
  // The usual film screen is what this browser learned, whatever is aimed now.
  const { destinationFor } = usePlayDestination({ aimIds: NO_IDS });
  const devices = fleet?.devices ?? NO_IDS;
  const localId = fleet?.identity?.deviceId ?? null;
  const usual = destinationFor(FILM);
  const usualKey = usual.source === 'learned' ? usual.targetIds.join(',') : '';
  const order = useMemo(
    () => destinationCycle({ devices, usualIds: usualKey ? usualKey.split(',') : NO_IDS, localId }),
    [devices, usualKey, localId],
  );
  const targetIds = aim?.targetIds ?? NO_IDS;
  const current = useMemo(() => describeAim(order, targetIds, devices), [order, targetIds, devices]);
  const setTargets = aim?.setTargets;

  const cycle = useCallback((dir = 1, via = 'tab') => {
    if (!setTargets) return false;
    const next = nextDestination(order, current.targetIds, dir === -1 ? -1 : 1);
    setTargets(next.targetIds);
    mediaLog.searchDestinationCycled({ from: aimKey(targetIds), to: aimKey(next.targetIds), via });
    return true;
  }, [setTargets, order, current.targetIds, targetIds]);

  return { current, cycle };
}

export function DestinationChip() {
  const aim = useContext(CastTargetContext);
  const fleet = useContext(FleetContext);
  const identity = useContext(ClientIdentityContext);
  const { current, cycle } = useDestinationCycle();

  // Let go of an aim at a screen that is gone — only once the fleet has
  // actually answered (a restored aim must survive the first, empty render).
  const fleetSettled = !!fleet && !fleet.loading && !fleet.error && (fleet.devices?.length ?? 0) > 0;
  const targetIds = aim?.targetIds ?? NO_IDS;
  const setTargets = aim?.setTargets;
  useEffect(() => {
    if (!current.stale || !fleetSettled || !setTargets) return;
    const present = targetIds.filter((id) => fleet.devices.some((d) => d.id === id));
    mediaLog.searchDestinationStale({ targetIds: targetIds.filter((id) => !present.includes(id)) });
    setTargets(present);
  }, [current.stale, fleetSettled, setTargets, targetIds, fleet]);

  if (!aim) return null;
  const here = current.targetIds.length === 0;
  return (
    <>
      <UnstyledButton
        data-testid="search-destination-chip"
        className="media-destination-chip"
        data-here={here || undefined}
        aria-label={`Plays on ${current.label}. Change where things play`}
        title="Where ▶ plays — Tab to change"
        // The search box keeps its focus, words and open list.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          // Reaching for the destination answers the naming prompt anchored here.
          if (identity?.firstUse) identity.completeFirstUse?.('skipped');
          cycle(1, 'click');
        }}
      >
        {!here && <UiIcon name="television" size={16} className="media-destination-chip-icon" />}
        <span className="media-destination-chip-text">▶ {current.label}</span>
      </UnstyledButton>
      <span className="media-sr-only" role="status" aria-live="polite" data-testid="search-destination-announcement">
        {`Plays on ${current.label}`}
      </span>
    </>
  );
}

export default DestinationChip;
