import { ordinal } from './standingsFormat.js';

/**
 * Ceremony copy for deriveRaceSnapshot's edge-triggered drama events — pure,
 * no JSX/icons (those are a view-layer lookup keyed on `variant`; see
 * CycleGameContainer's recordDramaEvent). Kept out of the container (already
 * flagged by the 2026-07-01 audit as a god component) so the event→toast
 * mapping is independently testable without mounting React or driving the
 * race tick loop.
 *
 * RIDER_FINISHED doubles as the finish-line ceremony (audit feedback
 * 2026-07-02): a distance-goal crossing gets its own celebratory moment the
 * instant it happens, not just a row on the end-of-race results screen. Ties
 * (two riders crossing in the same tick) are ordered by their actual finish
 * time so placements are always correct.
 *
 * @param {{type:string, riderIds:string[]}} event   one entry from deriveRaceSnapshot(...).events
 * @param {object} snapshot                          the deriveRaceSnapshot(...) result the event came from
 * @param {object} riders                            engineState.riders (for displayName lookup)
 * @returns {Array<{variant:string, title:string, subtitle?:string}>}
 */
export function dramaEventToasts(event, snapshot, riders) {
  const nameOf = (id) => riders?.[id]?.displayName || id;
  const toasts = [];

  if (event.type === 'LEAD_CHANGE') {
    const leaderId = event.riderIds[0];
    if (leaderId) toasts.push({ variant: 'lead-change', title: `${nameOf(leaderId)} takes the lead!` });
  } else if (event.type === 'RIDER_FINISHED') {
    const ridersView = snapshot?.ridersView || {};
    const finishedBefore = Object.values(ridersView).filter((r) => r.finishTimeS != null).length - event.riderIds.length;
    const sorted = [...event.riderIds].sort((a, b) => (ridersView[a]?.finishTimeS ?? 0) - (ridersView[b]?.finishTimeS ?? 0));
    sorted.forEach((riderId, i) => {
      const place = finishedBefore + i + 1;
      toasts.push({
        variant: 'finished',
        title: `${nameOf(riderId)} finishes ${ordinal(place)}!`,
        subtitle: place === 1 ? 'Crosses the line first' : undefined,
      });
    });
  } else if (event.type === 'PHOTO_FINISH') {
    toasts.push({ variant: 'photo-finish', title: 'Photo finish!', subtitle: 'The lead is razor-thin' });
  } else if (event.type === 'FINAL_LAP') {
    const riderId = event.riderIds[0];
    toasts.push({ variant: 'final-lap', title: riderId ? `${nameOf(riderId)} — final lap!` : 'Final lap!' });
  } else if (event.type === 'LAPPING_IMMINENT') {
    const riderId = event.riderIds[0];
    toasts.push({ variant: 'lapping', title: riderId ? `${nameOf(riderId)} is about to lap the field!` : 'About to lap the field!' });
  }
  return toasts;
}

export default dramaEventToasts;
