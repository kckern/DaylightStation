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
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '@mantine/core';
import { IconPlayerPlayFilled } from '@tabler/icons-react';
import { useCastTarget } from './useCastTarget.js';
import { DispatchTargetPicker } from './DispatchTargetPicker.jsx';
import { GlobalAimLabel } from './AimLabel.jsx';
import { useDismissLayer } from '../shell/useDismissLayer.js';
import mediaLog from '../logging/mediaLog.js';
import './Cast.scss';

// SearchMode is a fixed phone surface at Mantine's modal tier (z-index 200). Mantine portals Modal
// at the document root, so its default modal layer (200) would sit behind the
// search surface and leave the visible picker unable to receive pointer taps.
const DESTINATION_MODAL_Z_INDEX = 600;

// Order-independent identity for the destination_changed from/to fields —
// picking the same two devices in a different order isn't a change.
function targetsKey(ids) {
  return ids.length === 0 ? 'local' : [...ids].sort().join(',');
}

function DestinationInteractionSurface({ onUnmount, children }) {
  useEffect(() => () => onUnmount(), [onUnmount]);
  return <div data-testid="destination-sheet">{children}</div>;
}

export function DestinationLine({ surface, onInteractionStart, onInteractionEnd } = {}) {
  const [open, setOpen] = useState(false);
  const interactionStartedRef = useRef(false);
  const provisionalCleanupRef = useRef(null);
  const wasOpenRef = useRef(false);
  const interactionEndRef = useRef(onInteractionEnd);
  interactionEndRef.current = onInteractionEnd;
  const { targetIds, mode, clearTargets, toggleTarget, setMode } = useCastTarget();

  const close = useCallback(() => setOpen(false), []);
  // Mantine's own window-capture Escape can close and unregister the Modal
  // before the shell's document-bubble handler observes the same event.
  // Let the shell own this layer instead so one Escape has one owner.
  useDismissLayer(open, close);

  const startInteraction = useCallback(() => {
    if (interactionStartedRef.current) return;
    interactionStartedRef.current = true;
    onInteractionStart?.();
  }, [onInteractionStart]);
  const clearProvisionalInteraction = useCallback(() => {
    provisionalCleanupRef.current?.();
    provisionalCleanupRef.current = null;
  }, []);
  const finishInteraction = useCallback(() => {
    clearProvisionalInteraction();
    if (!interactionStartedRef.current) return;
    interactionStartedRef.current = false;
    interactionEndRef.current?.();
  }, [clearProvisionalInteraction]);
  useEffect(() => () => finishInteraction(), [finishInteraction]);

  const openPicker = useCallback(() => {
    startInteraction();
    // A click (including native Enter/Space activation) transfers the
    // provisional trigger lifetime to the Modal. Keep the outer search held,
    // but remove trigger-only cancellation listeners before opening the sheet.
    clearProvisionalInteraction();
    wasOpenRef.current = true;
    setOpen(true);
  }, [startInteraction, clearProvisionalInteraction]);
  const handleTriggerPointerDown = useCallback((event) => {
    startInteraction();
    clearProvisionalInteraction();

    const trigger = event.currentTarget;
    const ownerDocument = trigger.ownerDocument;
    const pointerId = event.pointerId;
    const matchesPointer = (nextEvent) => (
      pointerId == null || nextEvent.pointerId == null || nextEvent.pointerId === pointerId
    );
    const cancelProvisional = (nextEvent) => {
      if (!matchesPointer(nextEvent)) return;
      finishInteraction();
    };
    const cancelReleasedOutside = (nextEvent) => {
      if (!matchesPointer(nextEvent) || trigger.contains(nextEvent.target)) return;
      finishInteraction();
    };
    const cancelBeforeOutsidePointer = (nextEvent) => {
      if (trigger.contains(nextEvent.target)) return;
      finishInteraction();
    };
    const cancelAfterOutsideClick = (nextEvent) => {
      if (trigger.contains(nextEvent.target)) return;
      finishInteraction();
    };

    ownerDocument.addEventListener('pointercancel', cancelProvisional, true);
    ownerDocument.addEventListener('pointerup', cancelReleasedOutside, true);
    ownerDocument.addEventListener('pointerdown', cancelBeforeOutsidePointer, true);
    ownerDocument.addEventListener('click', cancelAfterOutsideClick, true);
    provisionalCleanupRef.current = () => {
      ownerDocument.removeEventListener('pointercancel', cancelProvisional, true);
      ownerDocument.removeEventListener('pointerup', cancelReleasedOutside, true);
      ownerDocument.removeEventListener('pointerdown', cancelBeforeOutsidePointer, true);
      ownerDocument.removeEventListener('click', cancelAfterOutsideClick, true);
    };
  }, [startInteraction, clearProvisionalInteraction, finishInteraction]);
  const handleTriggerFocus = useCallback(() => {
    if (open || !wasOpenRef.current) return;
    wasOpenRef.current = false;
    finishInteraction();
  }, [open, finishInteraction]);

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
    close();
  }, [targetIds, clearTargets, toggleTarget, setMode, surface, close]);

  return (
    <>
      <button
        type="button"
        data-testid="destination-line"
        data-ignore-outside-clicks
        className="cast-destination-line"
        onPointerDown={handleTriggerPointerDown}
        onFocus={handleTriggerFocus}
        onClick={openPicker}
      >
        <IconPlayerPlayFilled size={14} aria-hidden="true" />
        <span data-testid="destination-line-name">
          <GlobalAimLabel compact />
        </span>
      </button>
      <Modal
        opened={open}
        onClose={close}
        title="Destination"
        centered
        size="sm"
        zIndex={DESTINATION_MODAL_Z_INDEX}
        closeOnEscape={false}
        transitionProps={{ duration: 0 }}
      >
        <DestinationInteractionSurface onUnmount={finishInteraction}>
          {/* intent="destination": this pick only changes the preferred
              target (submit() is a no-op dispatch here per the hasContent
              guard) — the chrome must say "Set destination", never "Cast",
              or the CTA would claim an action it doesn't perform. */}
          <DispatchTargetPicker onComplete={handlePicked} intent="destination" />
        </DestinationInteractionSurface>
      </Modal>
    </>
  );
}

export default DestinationLine;
