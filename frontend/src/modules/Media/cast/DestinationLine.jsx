// frontend/src/modules/Media/cast/DestinationLine.jsx
// Makes the dispatch destination visible where a user is about to act,
// instead of hidden state silently deciding where a tap goes (incident:
// a user couldn't tell where a tap would go, couldn't find the device they
// wanted, and fell back to a separate devices page). Reads the SAME
// CastTargetProvider state as the dock's CastTargetChip — this line and
// that chip are two views of ONE state and must never diverge, so a pick
// made here writes back through the identical toggleTarget/setMode setters
// the chip uses (not a parallel state of its own).
//
// No layout-specific props — everything comes from context, like
// ScopeChips. `surface` is optional and used only to tag the
// dispatch.destination_changed log line; mounted unchanged by SearchMode's
// full-screen surface (Task 13) and the container browse header (Task 15).
import React, { useCallback, useState } from 'react';
import { Modal } from '@mantine/core';
import { useCastTarget } from './useCastTarget.js';
import { useFleetContext } from '../fleet/FleetProvider.jsx';
import { deviceName } from '../fleet/deviceDisplay.js';
import { DispatchTargetPicker } from './DispatchTargetPicker.jsx';
import { useDismissLayer } from '../shell/DismissStackProvider.jsx';
import mediaLog from '../logging/mediaLog.js';
import './Cast.scss';

function destinationLabel(targetIds, devices) {
  if (targetIds.length === 0) return 'This browser';
  if (targetIds.length === 1) {
    return deviceName(devices.find((d) => d.id === targetIds[0]), targetIds[0]);
  }
  return `${targetIds.length} devices`;
}

// Order-independent identity for the destination_changed from/to fields —
// picking the same two devices in a different order isn't a change.
function targetsKey(ids) {
  return ids.length === 0 ? 'local' : [...ids].sort().join(',');
}

export function DestinationLine({ surface } = {}) {
  const [open, setOpen] = useState(false);
  const { targetIds, clearTargets, toggleTarget, setMode } = useCastTarget();
  const { devices } = useFleetContext();

  const close = useCallback(() => setOpen(false), []);
  useDismissLayer(open, close, { managed: true });

  const name = destinationLabel(targetIds, devices);

  // The sheet body (DispatchTargetPicker) is the SAME tap-a-device cast
  // picker used everywhere else — reused, not redesigned. A pick here both
  // dispatches (when the picker had real content to send) and — the part
  // specific to this line — becomes the new shared preferred destination,
  // so CastTargetChip reflects it immediately too.
  const handlePicked = useCallback(({ targetIds: nextIds, mode: nextMode }) => {
    const from = targetsKey(targetIds);
    const to = targetsKey(nextIds);
    if (from !== to) {
      mediaLog.destinationChanged({ from, to, surface: surface ?? null });
    }
    clearTargets();
    nextIds.forEach((id) => toggleTarget(id));
    setMode(nextMode);
    setOpen(false);
  }, [targetIds, clearTargets, toggleTarget, setMode, surface]);

  return (
    <>
      <button
        type="button"
        data-testid="destination-line"
        className="cast-destination-line"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">▶</span> Playing to: <strong data-testid="destination-line-name">{name}</strong>
      </button>
      <Modal
        opened={open}
        onClose={close}
        title="Destination"
        centered
        size="sm"
        transitionProps={{ duration: 0 }}
      >
        <div data-testid="destination-sheet">
          {/* intent="destination": this pick only changes the preferred
              target (submit() is a no-op dispatch here per the hasContent
              guard) — the chrome must say "Set destination", never "Cast",
              or the CTA would claim an action it doesn't perform. */}
          <DispatchTargetPicker onComplete={handlePicked} intent="destination" />
        </div>
      </Modal>
    </>
  );
}

export default DestinationLine;
